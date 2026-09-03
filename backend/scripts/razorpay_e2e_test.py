"""Razorpay card E2E with robust Maybe-later / Success clicks."""
from __future__ import annotations

import json
import random

import requests
from playwright.sync_api import sync_playwright

API = "http://127.0.0.1:8001"
WEB = "http://127.0.0.1:5500"
SHOT = r"D:\JOD-Events\backend\scripts"


def register():
    s = requests.Session()
    suffix = random.randint(10000, 99999)
    email = f"rzp.e2e.{suffix}@gmail.com"
    payload = {
        "email": email,
        "username": f"rzp_e2e_{suffix}",
        "password": "Test@1234!",
        "full_name": "Razorpay E2E",
        "phone": "9123456780",
        "accepted_privacy_policy": True,
    }
    r = s.post(f"{API}/api/auth/register", json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    user = data.get("user") or {"email": email, "full_name": "Razorpay E2E", "phone": "9123456780"}
    token = next(c.value for c in s.cookies if c.name == "jod_access_token")
    return s, token, user


def js_click_text(page, text: str) -> str | None:
    script = """
    (text) => {
      const nodes = Array.from(document.querySelectorAll('button, a, div, span, p'));
      for (const el of nodes) {
        const t = (el.innerText || el.textContent || '').trim();
        if (t === text) {
          el.click();
          return true;
        }
      }
      return false;
    }
    """
    for frame in list(page.frames):
        try:
            if frame.evaluate(script, text):
                return f"{text}@{frame.url[:60]}"
        except Exception:
            continue
    return None


def main():
    session, token, user = register()
    print("USER", user["email"], flush=True)
    bill = {
        "eventId": "rzp-e2e-event",
        "eventTitle": "Razorpay E2E Event",
        "ticket": "General Admission",
        "price": 1,
        "quantity": 1,
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        context.add_cookies(
            [
                {
                    "name": "jod_access_token",
                    "value": token,
                    "domain": "127.0.0.1",
                    "path": "/",
                    "httpOnly": True,
                    "secure": False,
                    "sameSite": "Lax",
                }
            ]
        )
        page = context.new_page()
        page.add_init_script(
            f"""
            localStorage.setItem('jod_user', {json.dumps(json.dumps(user))});
            sessionStorage.setItem('jod_user', {json.dumps(json.dumps(user))});
            sessionStorage.setItem('jod_pending_ticket_bill', {json.dumps(json.dumps(bill))});
            """
        )
        page.goto(
            f"{WEB}/payment.html?eventId=rzp-e2e-event&ticket=General+Admission&price=1",
            wait_until="domcontentloaded",
            timeout=60000,
        )
        page.wait_for_selector("#payNowBtn", timeout=20000)
        page.click("#payNowBtn")
        page.wait_for_timeout(3000)

        print("CONTACT", js_click_text(page, "Continue"), flush=True)
        page.wait_for_timeout(1000)
        print("CARDS", js_click_text(page, "Cards"), flush=True)
        page.wait_for_timeout(1000)

        for frame in page.frames:
            try:
                if frame.locator('input[name="card.number"]').count() == 0:
                    continue
                frame.locator('input[name="card.number"]').first.fill("4100280000001007")
                frame.locator('input[name="card.expiry"]').first.fill("12/26")
                frame.locator('input[name="card.cvv"]').first.fill("123")
                print("CARD_FILLED", flush=True)
            except Exception as exc:
                print("CARD_ERR", exc, flush=True)

        page.screenshot(path=f"{SHOT}\\rzp_card_filled.png", full_page=True)
        print("CONTINUE1", js_click_text(page, "Continue"), flush=True)
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{SHOT}\\rzp_after_continue1.png", full_page=True)

        for attempt in range(5):
            hit = js_click_text(page, "Maybe later")
            print("MAYBE", attempt, hit, flush=True)
            if hit:
                break
            page.wait_for_timeout(800)

        page.wait_for_timeout(1500)
        page.screenshot(path=f"{SHOT}\\rzp_after_maybe.png", full_page=True)

        # If still on card form, continue again once
        print("CONTINUE2", js_click_text(page, "Continue"), flush=True)

        for i in range(50):
            if "thank-you" in page.url:
                break
            for label in ("Success", "Authenticate", "Submit OTP", "Submit", "Verify"):
                hit = js_click_text(page, label)
                if hit:
                    print("HIT", hit, flush=True)
            for frame in list(page.frames):
                try:
                    for sel in ('input[name="otp"]', 'input[placeholder*="OTP" i]', 'input[maxlength="6"]'):
                        loc = frame.locator(sel)
                        if not loc.count():
                            continue
                        name = (loc.first.get_attribute("name") or "")
                        ph = (loc.first.get_attribute("placeholder") or "").lower()
                        if "card" in name or "mm" in ph:
                            continue
                        loc.first.fill("123456")
                        print("OTP_FILLED", flush=True)
                        js_click_text(page, "Submit")
                        js_click_text(page, "Submit OTP")
                except Exception:
                    pass
            if i % 5 == 0:
                print("WAIT", i, "frames", len(page.frames), flush=True)
                page.screenshot(path=f"{SHOT}\\rzp_wait_{i}.png", full_page=True)
            page.wait_for_timeout(1500)

        page.screenshot(path=f"{SHOT}\\rzp_final.png", full_page=True)
        print("FINAL_URL", page.url, flush=True)
        ok = "thank-you" in page.url
        print("RESULT", "PASS" if ok else "FAIL", flush=True)
        browser.close()
        return 0 if ok else 3


if __name__ == "__main__":
    raise SystemExit(main())
