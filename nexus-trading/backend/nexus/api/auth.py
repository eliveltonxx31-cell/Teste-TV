"""Single-operator authentication: scrypt password hash in env + HS256 JWT."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from nexus.config import get_settings

_bearer = HTTPBearer(auto_error=False)
_attempts: dict[str, list[float]] = {}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_b64, dk_b64 = stored.split("$", 2)
    candidate = hash_password(password, base64.b64decode(salt_b64))
    return hmac.compare_digest(candidate.split("$", 2)[2], dk_b64)


def _secret() -> str:
    secret = get_settings().jwt_secret
    if not secret or len(secret) < 32:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "JWT_SECRET not configured (>=32 chars)")
    return secret


def login(username: str, password: str, client: str) -> str:
    now = time.time()
    window = [t for t in _attempts.get(client, []) if now - t < 300]
    if len(window) >= 10:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many attempts, wait 5 minutes")
    s = get_settings()
    ok = hmac.compare_digest(username, s.admin_user) and verify_password(password, s.admin_password_hash)
    if not ok:
        window.append(now)
        _attempts[client] = window
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    _attempts.pop(client, None)
    exp = datetime.now(timezone.utc) + timedelta(hours=s.jwt_ttl_hours)
    return jwt.encode({"sub": username, "exp": exp}, _secret(), algorithm="HS256")


def current_user(request: Request,
                 creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    token = creds.credentials if creds else request.query_params.get("token")  # SSE can't set headers
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing token")
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    return payload["sub"]
