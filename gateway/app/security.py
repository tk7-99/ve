import hashlib
import hmac
from fastapi import HTTPException


def digest(secret: str, purpose: str, value: str) -> str:
    return hmac.new(
        secret.encode(),
        (purpose + ":" + value).encode(),
        hashlib.sha256,
    ).hexdigest()


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
