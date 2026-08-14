# JOD Events — Line-by-Line Guide: Services, Utils, & Authentication

This document provides a line-by-line and block-by-block educational walkthrough for the services, utilities, and security modules of the JOD Events codebase.

---

## 1. `backend/Services/auth_service.py`

### Source Code
```python
1: """
2: Authentication service — password hashing and JWT token creation.
3: """
4: 
5: import bcrypt
6: from Authentication.jwt_handler import create_access_token   # re-export
7: 
8: _BCRYPT_MAX_BYTES = 72
9: 
10: 
11: def _to_bytes(s: str) -> bytes:
12:     """Encode string to bytes for bcrypt, truncating safely at 72 bytes."""
13:     try:
14:         encoded = s.encode("utf-8")
15:     except UnicodeEncodeError:
16:         encoded = s.encode("utf-8", errors="ignore")
17:     if len(encoded) > _BCRYPT_MAX_BYTES:
18:         encoded = encoded[:_BCRYPT_MAX_BYTES]
19:     return encoded
20: 
21: 
22: def get_password_hash(password: str) -> str:
23:     """Hash a plain-text password using bcrypt."""
24:     pw = _to_bytes(password)
25:     salt = bcrypt.gensalt()
26:     hashed = bcrypt.hashpw(pw, salt)
27:     return hashed.decode("utf-8")
28: 
29: 
30: def verify_password(plain_password: str, hashed_password: str) -> bool:
31:     """Verify a plain-text password against a bcrypt hash."""
32:     pw = _to_bytes(plain_password)
33:     try:
34:         stored = hashed_password.encode("utf-8")
35:     except Exception:
36:         return False
37:     try:
38:         return bool(bcrypt.checkpw(pw, stored)) 
39:     except ValueError:
40:         return False
```

### Detailed Line-by-Line Breakdown

* **Line 5: `import bcrypt`**
  * **What it does:** Imports Python's native `bcrypt` cryptographic library.
  * **Why it exists:** Bcrypt is a battle-tested password hashing algorithm that incorporates salt to protect against rainbow table attacks and brute force cracking.
* **Line 8: `_BCRYPT_MAX_BYTES = 72`**
  * **What it does:** Sets a constant integer `72`.
  * **Why it exists:** Standard bcrypt algorithms inherently truncate inputs beyond 72 bytes. Setting this limit explicitly prevents denial-of-service (DoS) attacks caused by abnormally large password strings.
* **Lines 11-19: `def _to_bytes(s: str) -> bytes:`**
  * **What it does:** Helper function converting any input password string `s` into UTF-8 encoded bytes, safely truncating at 72 bytes.
  * **Inputs/Outputs:** String input -> Bytes output.
* **Lines 22-27: `def get_password_hash(password: str) -> str:`**
  * **What it does:** Generates a random cryptographic salt (`bcrypt.gensalt()`), hashes the password bytes (`bcrypt.hashpw`), and returns a UTF-8 string hash.
  * **Effect on app:** Called during user registration (`/api/auth/register`) to ensure plain-text passwords are never saved in database tables.
* **Lines 30-40: `def verify_password(plain_password: str, hashed_password: str) -> bool:`**
  * **What it does:** Converts plain user login input to bytes and compares it against the stored database bcrypt hash using `bcrypt.checkpw()`. Returns `True` if password matches, `False` otherwise.
  * **Effect on app:** Called during user login (`/api/auth/login`) to authenticate identity.

---

## 2. `backend/Authentication/jwt_handler.py`

### Source Code
```python
5: import os
6: from datetime import datetime, timedelta
7: from typing import Optional
8: 
9: from jose import JWTError, jwt
10: from dotenv import load_dotenv
11: 
12: load_dotenv()
13: 
14: SECRET_KEY = os.getenv("SECRET_KEY", "change-this-to-a-strong-secret-key-in-production")
15: ALGORITHM  = os.getenv("JWT_ALGORITHM", "HS256")
16: ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
17: 
18: 
19: def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
20:     to_encode = data.copy()
21:     expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
22:     to_encode.update({"exp": expire})
23:     return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
24: 
25: 
26: def decode_access_token(token: str) -> Optional[dict]:
27:     try:
28:         return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
29:     except JWTError:
30:         return None
```

### Detailed Line-by-Line Breakdown

* **Line 9: `from jose import JWTError, jwt`**
  * **What it does:** Imports `jose` (JavaScript Object Signing and Encryption) library functions for JWT creation and decoding.
* **Lines 14-16:**
  * `SECRET_KEY`: Private cryptographic key used to sign tokens so clients cannot tamper with user IDs.
  * `ALGORITHM`: `HS256` (HMAC with SHA-256 hash algorithm).
  * `ACCESS_TOKEN_EXPIRE_MINUTES`: Sets default token lifespan (e.g. 60 minutes or 4,320 minutes).
* **Lines 19-23: `create_access_token(data: dict, ...)`**
  * **What it does:** Copies the payload dictionary (e.g. `{"sub": "CUST-102948"}`), adds an expiration timestamp (`exp`), and signs it using `SECRET_KEY`.
  * **Output:** Encoded string like `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`.
* **Lines 26-30: `decode_access_token(token: str)`**
  * **What it does:** Verifies the cryptographic signature of an incoming token string. If signature is valid and token is not expired, returns the decoded dictionary payload. If invalid or expired, catches `JWTError` and returns `None`.

---

## 3. `backend/Authentication/dependencies.py`

### Source Code
```python
14: oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
15: 
16: 
17: def get_current_user(
18:     token: str = Depends(oauth2_scheme),
19:     db: Session = Depends(get_db),
20: ) -> User:
21:     credentials_exception = HTTPException(
22:         status_code=status.HTTP_401_UNAUTHORIZED,
23:         detail="Could not validate credentials.",
24:         headers={"WWW-Authenticate": "Bearer"},
25:     )
26: 
27:     payload = decode_access_token(token)
28:     if payload is None:
29:         raise credentials_exception
30: 
31:     customer_id: str = payload.get("customer_id") or payload.get("sub")
32:     if customer_id is None:
33:         raise credentials_exception
34: 
35:     user = db.query(User).filter(User.customer_id == customer_id).first()
36:     if user is None and payload.get("email"):
37:         user = db.query(User).filter(User.email == payload.get("email")).first()
38:     if user is None:
39:         user = db.query(User).filter(User.id == customer_id).first()
40:     if user is None:
41:         raise credentials_exception
42:     if not user.is_active:
43:         raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user.")
44: 
45:     return user
```

### Detailed Line-by-Line Breakdown

* **Line 14: `oauth2_scheme = OAuth2PasswordBearer(...)`**
  * **What it does:** Instantiates FastAPI's `OAuth2PasswordBearer` scheme. It inspects incoming HTTP requests for an `Authorization: Bearer <token>` header.
* **Line 17-20: `get_current_user(...)`**
  * **What it does:** FastAPI dependency that automatically extracts the token from headers, fetches a database session via `get_db`, and returns the authenticated `User` object.
* **Line 27-29:** Calls `decode_access_token(token)`. If signature fails or token expired, raises `401 Unauthorized`.
* **Lines 31-40:** Extracts `customer_id` / `sub` claim. Queries database `users` table across fallback identifiers (`customer_id`, `email`, or `id`).
* **Line 42-43:** Checks `user.is_active`. If false, raises `403 Forbidden`.
* **Line 45:** Returns the active `User` model instance to the endpoint handler.

---

## 4. `backend/Services/geo_service.py`

### Source Code
```python
1: import math
2: 
3: 
4: def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
5:     """
6:     Calculate the great-circle distance between two points on the Earth's surface (in kilometers).
7:     """
8:     R = 6371.0  # Earth's mean radius in kilometers
9: 
10:     dlat = math.radians(lat2 - lat1)
11:     dlon = math.radians(lon2 - lon1)
12: 
13:     a = (
14:         math.sin(dlat / 2) ** 2
15:         + math.cos(math.radians(lat1))
16:         * math.cos(math.radians(lat2))
17:         * math.sin(dlon / 2) ** 2
18:     )
19:     c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
20: 
21:     return R * c
```

### Detailed Line-by-Line Breakdown

* **Line 8: `R = 6371.0`**
  * Average radius of planet Earth in kilometers.
* **Lines 10-11: `dlat = math.radians(lat2 - lat1)`**
  * Converts coordinate differences from degrees to radians.
* **Lines 13-18:** Calculates the square of half the chord length between points `a`.
* **Line 19: `c = 2 * math.atan2(...)`**
  * Calculates the angular distance in radians `c`.
* **Line 21: `return R * c`**
  * Returns true distance in kilometers (e.g. `12.45` km).
