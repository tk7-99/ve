import hashlib
import hmac
from fastapi import HTTPException
from .security import digest


class Providers:
    def __init__(self, settings, http):
        self.s, self.http = settings, http

    async def send_email(self, email, code):
        response = await self.http.post(
            'https://api.resend.com/emails',
            headers={
                'Authorization': 'Bearer ' + self.s.resend_api_key.get_secret_value(),
                'Content-Type': 'application/json',
            },
            json={
                'from': self.s.resend_from,
                'to': [email],
                'subject': 'رمز الدخول إلى دَزّة',
                'text': f'رمز التحقق الخاص بك هو: {code}\nصلاحية الرمز خمس دقائق. لا تشاركه مع أي شخص.',
            },
        )
        if response.is_error:
            raise HTTPException(502, 'email_provider_error')

    async def login(self, identity, device_name):
        # Matrix shared-secret registration protocol; this is not message encryption.
        localpart = 'u_' + identity
        password = digest(self.s.password_secret.get_secret_value(), 'matrix-password', identity)
        url = self.s.matrix_internal_url
        response = await self.http.get(url + '/_synapse/admin/v1/register')
        if response.is_error:
            raise HTTPException(502, 'homeserver_unavailable')
        nonce = response.json()['nonce']
        mac = hmac.new(
            self.s.registration_shared_secret.get_secret_value().encode(),
            b'\x00'.join(x.encode() for x in [nonce, localpart, password, 'notadmin']),
            hashlib.sha1,
        ).hexdigest()
        response = await self.http.post(url + '/_synapse/admin/v1/register', json={
            'nonce': nonce,
            'username': localpart,
            'password': password,
            'admin': False,
            'mac': mac,
            'inhibit_login': True,
        })
        if response.is_error and response.json().get('errcode') != 'M_USER_IN_USE':
            raise HTTPException(502, 'registration_failed')
        response = await self.http.post(url + '/_matrix/client/v3/login', json={
            'type': 'm.login.password',
            'identifier': {'type': 'm.id.user', 'user': localpart},
            'password': password,
            'initial_device_display_name': device_name,
        })
        if response.is_error:
            raise HTTPException(502, 'login_failed')
        data = response.json()
        return {key: data[key] for key in ('access_token', 'user_id', 'device_id')}
