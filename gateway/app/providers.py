import hashlib
import hmac
from urllib.parse import quote
from fastapi import HTTPException
from .security import digest

class Providers:
    def __init__(self, settings, http):
        self.s, self.http = settings, http

    def sms_ready(self):
        if not (self.s.twilio_account_sid and self.s.twilio_auth_token.get_secret_value()
                and self.s.twilio_verify_service_sid):
            raise HTTPException(503, "sms_not_configured")

    async def twilio(self, action, data):
        self.sms_ready()
        url = f"https://verify.twilio.com/v2/Services/{self.s.twilio_verify_service_sid}/{action}"
        response = await self.http.post(url, data=data, auth=(self.s.twilio_account_sid,
                                       self.s.twilio_auth_token.get_secret_value()))
        if response.status_code == 429:
            raise HTTPException(429, "sms_rate_limited")
        if response.status_code == 404 and action == 'VerificationCheck':
            return {'status': 'expired'}
        if response.is_error:
            raise HTTPException(502, "sms_provider_error")
        return response.json()

    async def send(self, phone):
        await self.twilio('Verifications', {'To': phone, 'Channel': 'sms'})

    async def verify(self, phone, code):
        data = await self.twilio('VerificationCheck', {'To': phone, 'Code': code})
        return data.get('status') == 'approved'

    async def login(self, identity, device_name):
        # Matrix shared-secret registration protocol; this is not message encryption.
        localpart = 'u_' + identity
        password = digest(self.s.password_secret.get_secret_value(), 'matrix-password', identity)
        url = self.s.matrix_internal_url
        response = await self.http.get(url + '/_synapse/admin/v1/register')
        if response.is_error:
            raise HTTPException(502, 'homeserver_unavailable')
        nonce = response.json()['nonce']
        mac = hmac.new(self.s.registration_shared_secret.get_secret_value().encode(),
                       b'\x00'.join(x.encode() for x in [nonce, localpart, password, 'notadmin']),
                       hashlib.sha1).hexdigest()
        response = await self.http.post(url + '/_synapse/admin/v1/register', json={
            'nonce': nonce, 'username': localpart, 'password': password,
            'admin': False, 'mac': mac, 'inhibit_login': True})
        if response.is_error and response.json().get('errcode') != 'M_USER_IN_USE':
            raise HTTPException(502, 'registration_failed')
        response = await self.http.post(url + '/_matrix/client/v3/login', json={
            'type': 'm.login.password', 'identifier': {'type': 'm.id.user', 'user': localpart},
            'password': password, 'initial_device_display_name': device_name})
        if response.is_error:
            raise HTTPException(502, 'login_failed')
        data = response.json()
        return {key: data[key] for key in ('access_token', 'user_id', 'device_id')}
