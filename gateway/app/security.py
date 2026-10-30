import hashlib
import hmac
import phonenumbers
from fastapi import HTTPException

def normalize_phone(value: str) -> str:
    try:
        number = phonenumbers.parse(value, "IQ")
        if not phonenumbers.is_valid_number(number):
            raise ValueError()
        return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
    except (phonenumbers.NumberParseException, ValueError):
        raise HTTPException(422, "invalid_phone")

def digest(secret: str, purpose: str, value: str) -> str:
    return hmac.new(secret.encode(), (purpose + ":" + value).encode(), hashlib.sha256).hexdigest()

RATE_SCRIPT = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
"""
UNLOCK_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""

async def rate_limit(redis, key: str, limit: int, seconds: int):
    count = await redis.eval(RATE_SCRIPT, 1, 'rate:' + key, seconds)
    if count > limit:
        raise HTTPException(429, "too_many_attempts", headers={"Retry-After": str(seconds)})
