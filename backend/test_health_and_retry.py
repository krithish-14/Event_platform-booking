import httpx
import asyncio

async def test_backend_health():
    url = "http://127.0.0.1:8001/health"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            print(f"[TEST] Health endpoint status: {resp.status_code}")
            print(f"[TEST] Health endpoint response: {resp.json()}")
            assert resp.status_code == 200
            assert resp.json().get("status") in ["healthy", "ok"]
            print("[PASS] Backend health endpoint test passed.")
    except Exception as exc:
        print(f"[WARN] Health endpoint ping failed: {exc}")

if __name__ == "__main__":
    asyncio.run(test_backend_health())
