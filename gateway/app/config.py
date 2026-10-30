from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import SecretStr, field_validator

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str
    redis_url: str
    matrix_internal_url: str = "http://synapse:8008"
    matrix_public_url: str
    matrix_server_name: str
    registration_shared_secret: SecretStr
    identity_secret: SecretStr
    password_secret: SecretStr
    twilio_account_sid: str = ""
    twilio_auth_token: SecretStr = SecretStr("")
    twilio_verify_service_sid: str = ""

    @field_validator("identity_secret", "password_secret", "registration_shared_secret")
    @classmethod
    def strong_secret(cls, v):
        if len(v.get_secret_value()) < 32:
            raise ValueError("A random secret of at least 32 characters is required")
        return v

    @field_validator("matrix_public_url")
    @classmethod
    def require_https(cls, v):
        if not v.startswith("https://"):
            raise ValueError("Public homeserver must use HTTPS")
        return v.rstrip("/")
