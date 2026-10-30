import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi import HTTPException
from app.main import app
from app.security import digest
from app.config import Settings


class RedisFake:
    def __init__(self):
        self.data, self.counts = {}, {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    async def delete(self, key):
        return self.data.pop(key, None)

    async def eval(self, script, number, key, value):
        if "INCR" in script:
            self.counts[key] = self.counts.get(key, 0) + 1
            return self.counts[key]
        if self.data.get(key) == value:
            self.data.pop(key)
        return 1


@pytest.fixture
def state():
    settings = Settings(
        database_url='postgresql://test',
        redis_url='redis://test',
        matrix_public_url='https://matrix.example.test',
        matrix_server_name='matrix.example.test',
        registration_shared_secret='r' * 64,
        identity_secret='i' * 64,
        password_secret='p' * 64,
        resend_api_key='test-resend-key',
        resend_from='DAZZA <login@example.test>',
    )
    app.state.settings = settings
    app.state.redis = RedisFake()
    app.state.providers = SimpleNamespace(
        send_email=AsyncMock(),
        login=AsyncMock(return_value={
            'access_token': 'unit-test-token',
            'user_id': '@test:matrix.example.test',
            'device_id': 'TESTDEVICE',
        }),
    )
    app.state.http = SimpleNamespace(
        put=AsyncMock(return_value=SimpleNamespace(is_error=False)),
        get=AsyncMock(),
    )
    app.state.db = AsyncMock()
    return app.state


@pytest.fixture
def client():
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url='https://api.example.test',
    )


class AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *args):
        return False


class DatabaseConnection:
    def __init__(self, row):
        self.execute = AsyncMock()
        self.fetchrow = AsyncMock(return_value=row)

    def transaction(self):
        return AsyncContext(self)


async def request_email_code(client, state, email='person@example.test'):
    response = await client.post('/v1/auth/email/start', json={'email': email})
    assert response.status_code == 202
    code = state.providers.send_email.call_args.args[1]
    return response.json(), code


def test_identity_digest_is_domain_separated():
    assert digest('key', 'email', 'a') != digest('key', 'email-code', 'a')
    assert digest('key', 'email', 'a') == digest('key', 'email', 'a')
    assert len(digest('key', 'email', 'a')) == 64


@pytest.mark.asyncio
async def test_email_start_sends_one_code_and_stores_only_hash(state, client):
    async with client:
        response = await client.post(
            '/v1/auth/email/start',
            json={'email': '  Person@Example.test  '},
        )
        assert response.status_code == 202
        assert response.headers['cache-control'] == 'no-store'
        assert response.json()['expires_in'] == 300
        assert state.providers.send_email.await_count == 1
        assert state.providers.send_email.call_args.args[0] == 'person@example.test'
        challenge = response.json()['challenge_id']
        stored = json.loads(state.redis.data['email-challenge:' + challenge])
        assert 'code_hash' in stored
        assert 'code' not in stored
        assert state.providers.send_email.call_args.args[1] not in json.dumps(stored)


@pytest.mark.asyncio
async def test_email_invalid_and_unconfigured_requests_are_rejected(state, client):
    async with client:
        invalid = await client.post('/v1/auth/email/start', json={'email': 'not-an-email'})
        assert invalid.status_code == 422
        state.settings.resend_api_key = type(state.settings.resend_api_key)('')
        unavailable = await client.post(
            '/v1/auth/email/start',
            json={'email': 'person@example.test'},
        )
        assert unavailable.status_code == 503


@pytest.mark.asyncio
async def test_email_resend_cooldown_and_provider_failure(state, client):
    async with client:
        first = await client.post(
            '/v1/auth/email/start',
            json={'email': 'person@example.test'},
        )
        assert first.status_code == 202
        second = await client.post(
            '/v1/auth/email/start',
            json={'email': 'person@example.test'},
        )
        assert second.status_code == 429
        assert state.providers.send_email.await_count == 1

    state.redis = RedisFake()
    state.providers.send_email.side_effect = RuntimeError('provider unavailable')
    async with client:
        failed = await client.post(
            '/v1/auth/email/start',
            json={'email': 'other@example.test'},
        )
        assert failed.status_code == 502
        assert not any(k.startswith('email-challenge:') for k in state.redis.data)


@pytest.mark.asyncio
async def test_expired_email_challenge_cannot_authenticate(state, client):
    async with client:
        response = await client.post('/v1/auth/email/verify', json={
            'challenge_id': 'x' * 32,
            'code': '123456',
        })
        assert response.status_code == 401
        state.providers.login.assert_not_called()


@pytest.mark.asyncio
async def test_existing_user_can_login_without_profile_fields(state, client):
    connection = DatabaseConnection({
        'username': 'existing_user',
        'display_name': 'Existing User',
    })
    state.db = SimpleNamespace(acquire=lambda: AsyncContext(connection))
    async with client:
        started, code = await request_email_code(client, state)
        body = {'challenge_id': started['challenge_id'], 'code': code}
        response = await client.post('/v1/auth/email/verify', json=body)
        assert response.status_code == 200
        assert response.json()['username'] == 'existing_user'
        assert response.json()['display_name'] == 'Existing User'
        assert response.json()['homeserver'] == 'https://matrix.example.test'
        assert response.json()['device_id'] == 'TESTDEVICE'
        assert 'identity_hash' not in response.json()
        replay = await client.post('/v1/auth/email/verify', json=body)
        assert replay.status_code == 401
        state.providers.login.assert_awaited_once()


@pytest.mark.asyncio
async def test_new_user_must_complete_profile_without_losing_code(state, client):
    connection = DatabaseConnection(None)
    state.db = SimpleNamespace(acquire=lambda: AsyncContext(connection))
    async with client:
        started, code = await request_email_code(client, state)
        key = 'email-challenge:' + started['challenge_id']
        response = await client.post('/v1/auth/email/verify', json={
            'challenge_id': started['challenge_id'],
            'code': code,
        })
        assert response.status_code == 422
        assert response.json()['detail'] == 'profile_required'
        assert await state.redis.get(key) is not None
        state.providers.login.assert_not_called()


@pytest.mark.asyncio
async def test_new_user_can_register_after_completing_profile(state, client):
    connection = DatabaseConnection(None)
    state.db = SimpleNamespace(acquire=lambda: AsyncContext(connection))
    async with client:
        started, code = await request_email_code(client, state)
        response = await client.post('/v1/auth/email/verify', json={
            'challenge_id': started['challenge_id'],
            'code': code,
            'username': 'new_user',
            'display_name': 'New User',
        })
        assert response.status_code == 200
        assert response.json()['username'] == 'new_user'
        assert connection.execute.await_count == 3
        state.http.put.assert_awaited_once()


@pytest.mark.asyncio
async def test_email_verification_attempts_are_limited(state, client):
    async with client:
        started, _ = await request_email_code(client, state)
        body = {'challenge_id': started['challenge_id'], 'code': '000000'}
        for _ in range(10):
            assert (await client.post('/v1/auth/email/verify', json=body)).status_code == 401
        assert (await client.post('/v1/auth/email/verify', json=body)).status_code == 429
        state.providers.login.assert_not_called()


@pytest.mark.asyncio
async def test_user_directory_requires_matrix_session(state, client):
    async with client:
        response = await client.get('/v1/users/test_user')
        assert response.status_code == 401
        state.db.fetchrow.assert_not_called()
