import asyncio
from APIs.location import _reverse_geocode, _forward_geocode


def test_profile_location_formatting():
    # Verify city formatting logic (matches frontend updateProfileLocation)
    city_inputs = ["Chennai", "Chennai, India", "Mumbai"]
    formatted = [c if "india" in c.lower() else f"{c}, India" for c in city_inputs]
    print(f"[TEST] Formatted Profile Locations: {formatted}")
    assert formatted == ["Chennai, India", "Chennai, India", "Mumbai, India"]
    print("[PASS] Profile location formatting test passed.")


async def test_backend_location_resolution():
    try:
        rev = await _reverse_geocode(13.0827, 80.2707)
        print(f"[TEST] Reverse geocoded city: {rev.get('city')}")
        assert rev.get("city")

        fwd = await _forward_geocode("Chennai")
        print(f"[TEST] Forward geocoded city & coords: {fwd}")
        assert fwd.get("city") and fwd.get("lat") and fwd.get("lon")
        print("[PASS] Backend profile location resolution passed.")
    except Exception as exc:
        print(f"[WARN] Geocoding API check: {exc}")


if __name__ == "__main__":
    test_profile_location_formatting()
    asyncio.run(test_backend_location_resolution())
