import asyncio
import json
import secrets
import os
from contextlib import asynccontextmanager
from typing import Annotated
import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from .config import Settings
from .providers import Providers
from .security import digest, rate_limit, UNLOCK_SCRIPT
import re


@asynccontextmanager
async def lifespan(app):
    s = Settings()
    app.state.settings = s
    app.state.redis = Redis.from_url(s.redis_url, decode_responses=True)
    app.state.db = await asyncpg.create_pool(s.database_url, min_size=1, max_size=10)
    app.state.http = httpx.AsyncClient(timeout=20)
    app.state.providers = Providers(s, app.state.http)
    yield
    await app.state.http.aclose()
    await app.state.redis.aclose()
    await app.state.db.close()


app = FastAPI(title='DAZZA Identity Gateway', version='0.2.0', lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
web_origins = [origin.strip() for origin in os.getenv('WEB_ORIGINS', '').split(',') if origin.strip()]
if web_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=web_origins,
        allow_credentials=False,
        allow_methods=['GET', 'POST', 'OPTIONS'],
        allow_headers=['Authorization', 'Content-Type'],
        max_age=600,
    )


class EmailStart(BaseModel):
    email: str = Field(min_length=6, max_length=254)


class EmailFinish(BaseModel):
    challenge_id: str = Field(pattern=r'^[A-Za-z0-9_-]{32}$')
    code: str = Field(pattern=r'^\d{6}$')
    # Existing users can leave profile fields empty. New accounts must provide both.
    username: str | None = Field(default=None, pattern=r'^[a-z][a-z0-9_]{2,29}$')
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    device_name: str = Field(default='DAZZA mobile', min_length=1, max_length=80)


@app.middleware('http')
async def protect_response(request, call_next):
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.get('/health')
async def health():
    return {'service': 'DAZZA identity', 'status': 'running'}


@app.post('/v1/auth/email/start', status_code=202)
async def email_start(body: EmailStart, request: Request):
    state = request.app.state
    email = body.email.strip().lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise HTTPException(422, 'invalid_email')
    if not (state.settings.resend_api_key.get_secret_value() and state.settings.resend_from):
        raise HTTPException(503, 'email_not_configured')

    identity = digest(state.settings.identity_secret.get_secret_value(), 'email', email)
    ip = digest(state.settings.identity_secret.get_secret_value(), 'ip', request.client.host)
    await rate_limit(state.redis, 'email-ip:' + ip, 10, 3600)
    await rate_limit(state.redis, 'email-address:' + identity, 5, 3600)
    if not await state.redis.set('email-cooldown:' + identity, '1', nx=True, ex=60):
        raise HTTPException(429, 'wait_before_resend', headers={'Retry-After': '60'})

    previous = await state.redis.get('email-active:' + identity)
    if previous:
        await state.redis.delete('email-challenge:' + previous)

    challenge = secrets.token_urlsafe(24)
    code = f'{secrets.randbelow(1000000):06d}'
    try:
        await state.providers.send_email(email, code)
    except Exception:
        await state.redis.delete('email-cooldown:' + identity)
        raise HTTPException(502, 'email_send_failed')

    code_hash = digest(state.settings.identity_secret.get_secret_value(), 'email-code', code)
    await state.redis.set(
        'email-challenge:' + challenge,
        json.dumps({'email': email, 'identity': identity, 'code_hash': code_hash}),
        ex=300,
    )
    await state.redis.set('email-active:' + identity, challenge, ex=300)
    return {'challenge_id': challenge, 'expires_in': 300, 'resend_after': 60}


@app.post('/v1/auth/email/verify')
async def email_verify(body: EmailFinish, request: Request):
    state = request.app.state
    key = 'email-challenge:' + body.challenge_id
    raw = await state.redis.get(key)
    if not raw:
        raise HTTPException(401, 'challenge_expired')

    data = json.loads(raw)
    identity = data['identity']
    await rate_limit(state.redis, 'email-verify:' + identity, 10, 600)

    lock = 'email-verify-lock:' + identity
    owner = secrets.token_hex(16)
    if not await state.redis.set(lock, owner, nx=True, ex=120):
        raise HTTPException(409, 'verification_in_progress')

    try:
        raw = await state.redis.get(key)
        if not raw:
            raise HTTPException(401, 'challenge_expired')
        data = json.loads(raw)
        expected = digest(state.settings.identity_secret.get_secret_value(), 'email-code', body.code)
        if not secrets.compare_digest(expected, data['code_hash']):
            raise HTTPException(401, 'invalid_or_expired_code')

        async with state.db.acquire() as db:
            async with db.transaction():
                await db.execute(
                    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                    identity,
                )
                row = await db.fetchrow(
                    'SELECT username, display_name FROM profiles WHERE identity_hash=$1',
                    identity,
                )

                # Do not consume a valid code when a new user still needs to fill
                # the required profile fields. The client can submit them and retry.
                if row is None and (not body.username or not body.display_name):
                    raise HTTPException(422, 'profile_required')

                await state.redis.delete(key)
                if row is None:
                    try:
                        await db.execute(
                            'INSERT INTO profiles(identity_hash,username,display_name) VALUES($1,$2,$3)',
                            identity, body.username, body.display_name,
                        )
                    except asyncpg.UniqueViolationError:
                        raise HTTPException(409, 'username_taken_request_new_code')
                    username, display_name = body.username, body.display_name
                else:
                    username, display_name = row['username'], row['display_name']

                session = await state.providers.login(identity, body.device_name)
                matrix_user = session['user_id']
                await db.execute(
                    'UPDATE profiles SET matrix_user_id=$1 WHERE identity_hash=$2',
                    matrix_user, identity,
                )

        if row is None:
            await state.http.put(
                state.settings.matrix_internal_url + '/_matrix/client/v3/profile/' + matrix_user + '/displayname',
                json={'displayname': display_name},
                headers={'Authorization': 'Bearer ' + session['access_token']},
            )

        return {
            **session,
            'homeserver': state.settings.matrix_public_url,
            'username': username,
            'display_name': display_name,
        }
    except httpx.HTTPError:
        raise HTTPException(502, 'upstream_unavailable')
    finally:
        await state.redis.eval(UNLOCK_SCRIPT, 1, lock, owner)


async def authenticate(request, authorization):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'authentication_required')
    response = await request.app.state.http.get(
        request.app.state.settings.matrix_internal_url + '/_matrix/client/v3/account/whoami',
        headers={'Authorization': authorization},
    )
    if response.status_code != 200:
        raise HTTPException(401, 'invalid_session')
    return response.json()['user_id']


@app.get('/v1/users/{username}')
async def find_user(
    username: str,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
):
    user_id = await authenticate(request, authorization)
    await rate_limit(request.app.state.redis, 'lookup:' + user_id, 60, 60)
    row = await request.app.state.db.fetchrow(
        'SELECT username,display_name,matrix_user_id FROM profiles WHERE username=$1',
        username.lower(),
    )
    if row is None or not row['matrix_user_id']:
        raise HTTPException(404, 'user_not_found')
    return dict(row)
