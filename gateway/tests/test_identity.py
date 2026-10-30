import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi import HTTPException
from app.main import app
from app.security import normalize_phone, digest
from app.config import Settings
from app.providers import Providers

class RedisFake:
    def __init__(self): self.data, self.counts = {}, {}
    async def get(self, key): return self.data.get(key)
    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data: return None
        self.data[key] = value
        return True
    async def delete(self, key): return self.data.pop(key, None)
    async def eval(self, script, number, key, value):
        if "INCR" in script:
            self.counts[key] = self.counts.get(key, 0) + 1
            return self.counts[key]
        if self.data.get(key) == value: self.data.pop(key)
        return 1

@pytest.fixture
def state():
    settings = Settings(database_url='postgresql://test', redis_url='redis://test',
                        matrix_public_url='https://matrix.example.test', matrix_server_name='matrix.example.test',
                        registration_shared_secret='r' * 64, identity_secret='i' * 64, password_secret='p' * 64)
    app.state.settings = settings
    app.state.redis = RedisFake()
    app.state.providers = SimpleNamespace(sms_ready=lambda: None, send=AsyncMock(), verify=AsyncMock(return_value=False))
    app.state.http = AsyncMock()
    app.state.db = AsyncMock()
    return app.state

@pytest.fixture
def client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://api.example.test')

@pytest.mark.parametrize('value', ['07901234567', '+9647901234567', '٠٧٩٠١٢٣٤٥٦٧'])
def test_iraqi_normalization(value):
    assert normalize_phone(value) == '+9647901234567'

@pytest.mark.parametrize('value', ['abc', '+123', '', '+9640000000000'])
def test_invalid_number(value):
    with pytest.raises(HTTPException) as exc: normalize_phone(value)
    assert exc.value.status_code == 422

def test_identity_digest_domain_separation():
    assert digest('key', 'phone', 'a') != digest('key', 'password', 'a')
    assert digest('key', 'phone', 'a') == digest('key', 'phone', 'a')
    assert len(digest('key', 'phone', 'a')) == 64

def test_no_provider_means_no_sms(state):
    with pytest.raises(HTTPException) as exc: Providers(state.settings, None).sms_ready()
    assert exc.value.status_code == 503

@pytest.mark.asyncio
async def test_sms_start_and_resend_cooldown(state, client):
    async with client:
        response = await client.post('/v1/auth/start', json={'phone': '07901234567'})
        assert response.status_code == 202
        assert response.headers['cache-control'] == 'no-store'
        assert 'phone' not in response.json()
        assert len(response.json()['challenge_id']) == 32
        response = await client.post('/v1/auth/start', json={'phone': '+9647901234567'})
        assert response.status_code == 429
        assert state.providers.send.await_count == 1

@pytest.mark.asyncio
async def test_expired_challenge_cannot_authenticate(state, client):
    async with client:
        response = await client.post('/v1/auth/verify', json={
            'challenge_id': 'x'*32, 'code': '123456', 'username': 'test_user', 'display_name': 'Test'})
        assert response.status_code == 401
        state.providers.verify.assert_not_called()

@pytest.mark.asyncio
async def test_wrong_code_never_provisions_account(state, client):
    async with client:
        first = await client.post('/v1/auth/start', json={'phone': '07901234567'})
        response = await client.post('/v1/auth/verify', json={
            'challenge_id': first.json()['challenge_id'], 'code': '000000', 'username': 'test_user', 'display_name': 'Test'})
        assert response.status_code == 401
        state.db.acquire.assert_not_called()
        assert not any(k.startswith('verify-lock:') for k in state.redis.data)

@pytest.mark.asyncio
async def test_verify_attempt_limit(state, client):
    async with client:
        first = await client.post('/v1/auth/start', json={'phone': '07901234567'})
        body = {'challenge_id': first.json()['challenge_id'], 'code': '000000', 'username': 'test_user', 'display_name': 'Test'}
        for _ in range(10): assert (await client.post('/v1/auth/verify', json=body)).status_code == 401
        assert (await client.post('/v1/auth/verify', json=body)).status_code == 429
        assert state.providers.verify.await_count == 10

@pytest.mark.asyncio
async def test_directory_requires_session(state, client):
    async with client:
        response = await client.get('/v1/users/test_user')
        assert response.status_code == 401
        state.db.fetchrow.assert_not_called()

@pytest.mark.asyncio
async def test_provider_failure_does_not_create_challenge(state, client):
    state.providers.send.side_effect = httpx.ConnectError('test transport failure')
    async with client:
        response = await client.post('/v1/auth/start', json={'phone': '07901234567'})
        assert response.status_code == 502
        assert not any(k.startswith('challenge:') for k in state.redis.data)

class AsyncContext:
    def __init__(self, value): self.value = value
    async def __aenter__(self): return self.value
    async def __aexit__(self, *args): return False

class DatabaseConnection:
    def __init__(self):
        self.execute = AsyncMock()
        self.fetchrow = AsyncMock(return_value={'username': 'existing', 'display_name': 'Existing'})
    def transaction(self): return AsyncContext(self)

@pytest.mark.asyncio
async def test_success_consumes_challenge_and_preserves_existing_username(state, client):
    connection = DatabaseConnection()
    state.db = SimpleNamespace(acquire=lambda: AsyncContext(connection))
    state.providers.verify.return_value = True
    state.providers.login = AsyncMock(return_value={'access_token': 'unit-test-token',
        'user_id': '@test:matrix.example.test', 'device_id': 'TESTDEVICE'})
    async with client:
        first = await client.post('/v1/auth/start', json={'phone': '07901234567'})
        body = {'challenge_id': first.json()['challenge_id'], 'code': '123456',
                'username': 'changed_name', 'display_name': 'Changed'}
        response = await client.post('/v1/auth/verify', json=body)
        assert response.status_code == 200
        assert response.json()['username'] == 'existing'
        assert response.json()['homeserver'] == 'https://matrix.example.test'
        assert response.json()['device_id'] == 'TESTDEVICE'
        assert 'identity_hash' not in response.json()
        replay = await client.post('/v1/auth/verify', json=body)
        assert replay.status_code == 401
        assert state.providers.login.await_count == 1
        assert not any(k.startswith('verify-lock:') for k in state.redis.data)

