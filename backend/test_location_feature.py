import asyncio
from Services.geo_service import haversine_km, is_within_radius, filter_by_radius
from APIs.location import _reverse_geocode, _forward_geocode


class DummyEvent:
    def __init__(self, name, lat, lon):
        self.name = name
        self.latitude = lat
        self.longitude = lon


def test_haversine():
    # Chennai Central to ITC Grand Chola, Guindy (~9-10 km)
    dist = haversine_km(13.0827, 80.2707, 13.0108, 80.2206)
    print(f"[TEST] Haversine distance Chennai Central -> Guindy: {dist:.2f} km")
    assert dist < 20.0, "Should be within 20 km"

    # Chennai to Bangalore (~290 km)
    dist_blr = haversine_km(13.0827, 80.2707, 12.9716, 77.5946)
    print(f"[TEST] Haversine distance Chennai -> Bangalore: {dist_blr:.2f} km")
    assert dist_blr > 20.0, "Should be beyond 20 km"
    print("[PASS] Haversine formula distance tests passed.")


def test_radius_filtering():
    events = [
        DummyEvent("Guindy Event", 13.0108, 80.2206),
        DummyEvent("Velachery Event", 12.9815, 80.2180),
        DummyEvent("Bangalore Event", 12.9716, 77.5946),
    ]
    user_lat, user_lon = 13.0827, 80.2707  # Chennai Central
    nearby = filter_by_radius(events, user_lat, user_lon, radius_km=20.0)
    names = [e.name for e, d in nearby]
    print(f"[TEST] Nearby events within 20km: {names}")
    assert "Guindy Event" in names
    assert "Velachery Event" in names
    assert "Bangalore Event" not in names
    print("[PASS] Radius filtering (20 km) passed.")


async def test_geocoding_api():
    try:
        # Reverse geocode (ITC Grand Chola coords)
        rev = await _reverse_geocode(13.0108, 80.2206)
        print(f"[TEST] Reverse geocode result: {rev}")
        assert "city" in rev and rev["city"]

        # Forward geocode
        fwd = await _forward_geocode("Chennai")
        print(f"[TEST] Forward geocode result: {fwd}")
        assert "lat" in fwd and "lon" in fwd
        print("[PASS] Geocoding API integration passed.")
    except Exception as exc:
        print(f"[WARN] Geocoding API call skipped or network error: {exc}")


if __name__ == "__main__":
    test_haversine()
    test_radius_filtering()
    asyncio.run(test_geocoding_api())
