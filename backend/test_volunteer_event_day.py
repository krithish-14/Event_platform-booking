from APIs.tickets import extract_scan_token


def test_extract_scan_token_from_ticket_url():
    token = "JOD-TKT-ABC123"
    url = f"https://jodevents.com/ticket-details.html?token={token}"
    assert extract_scan_token(url) == token


def test_extract_scan_token_from_pretty_url_and_hash():
    token = "JOD-TKT-DEF456"
    assert extract_scan_token(f"https://jodevents.com/ticket-details?token={token}") == token
    assert extract_scan_token(f"https://jodevents.com/ticket-details.html#token={token}") == token


def test_extract_scan_token_keeps_raw_qr():
    raw = "JOD-TKT-AABBCCDDEEFF00112233445566778899"
    assert extract_scan_token(raw) == raw


if __name__ == "__main__":
    test_extract_scan_token_from_ticket_url()
    test_extract_scan_token_from_pretty_url_and_hash()
    test_extract_scan_token_keeps_raw_qr()
    print("volunteer event day helpers ok")
