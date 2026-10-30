#!/usr/bin/env python3
"""Generate local secrets without printing them; never overwrites an existing setup."""
import argparse
import os
from pathlib import Path
import re
import secrets

p = argparse.ArgumentParser()
p.add_argument('--matrix-domain', required=True)
p.add_argument('--api-domain', required=True)
a = p.parse_args()
for domain in (a.matrix_domain, a.api_domain):
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}', domain):
        p.error('Use DNS hostnames without a scheme or port')
root = Path(__file__).resolve().parent.parent
if (root / '.env').exists():
    p.error('.env already exists; preserve its secrets and the existing database')
os.umask(0o077)
password, registration, identity, login = (secrets.token_hex(32) for _ in range(4))
(root / '.env').write_text(f"""POSTGRES_PASSWORD={password}
MATRIX_DOMAIN={a.matrix_domain}
API_DOMAIN={a.api_domain}
DATABASE_URL=postgresql://dazza:{password}@postgres/dazza_identity
REDIS_URL=redis://redis:6379/0
MATRIX_INTERNAL_URL=http://synapse:8008
MATRIX_PUBLIC_URL=https://{a.matrix_domain}
MATRIX_SERVER_NAME={a.matrix_domain}
REGISTRATION_SHARED_SECRET={registration}
IDENTITY_SECRET={identity}
PASSWORD_SECRET={login}
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
""")
config = root / 'infra/generated'
config.mkdir(exist_ok=True)
(config / 'homeserver.yaml').write_text(f"""server_name: '{a.matrix_domain}'
public_baseurl: 'https://{a.matrix_domain}/'
pid_file: /data/homeserver.pid
listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    resources:
      - names: [client]
        compress: false
database:
  name: psycopg2
  args:
    user: dazza
    password: '{password}'
    database: synapse
    host: postgres
    cp_min: 5
    cp_max: 10
log_config: /data/log.config
media_store_path: /data/media_store
max_upload_size: 25M
registration_shared_secret: '{registration}'
enable_registration: false
enable_metrics: false
report_stats: false
signing_key_path: /data/server.signing.key
trusted_key_servers: []
federation_domain_whitelist: []
allow_public_rooms_without_auth: false
encryption_enabled_by_default_for_room_type: all
rc_login:
  address: {{per_second: 0.2, burst_count: 10}}
  account: {{per_second: 0.1, burst_count: 5}}
""")
print('DAZZA local configuration created. Fill the three Twilio variables privately before starting.')
