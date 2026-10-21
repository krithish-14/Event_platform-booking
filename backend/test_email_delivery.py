import unittest
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from Services.email import (
    LOGO_CID,
    email_logo_bytes,
    envelope_address,
    html_message_part,
    smtp_login_users,
    smtp_message_bytes,
    smtp_password,
    wrap_html_body,
    wrap_text_body,
    zepto_api_url,
    zepto_authorization,
    zepto_inline_images,
    zepto_send_failure,
)


class EmailDeliveryTests(unittest.TestCase):
    def test_envelope_drops_display_name(self):
        self.assertEqual(
            envelope_address("JOD Events <noreply@jodevents.com>"),
            "noreply@jodevents.com",
        )

    def test_publish_otp_message_is_ascii_safe(self):
        msg = MIMEMultipart("mixed")
        msg["Subject"] = "Your verification code to publish your event \u2014 JOD Events"
        msg["From"] = "JOD Events <noreply@jodevents.com>"
        msg["To"] = "host@example.com"
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(wrap_text_body("Your code: 123456"), "plain", "utf-8"))
        msg.attach(alt)
        raw = smtp_message_bytes(msg)
        raw.decode("ascii")
        self.assertIn(b"=?utf-8?", raw)
        self.assertIn(b"noreply@jodevents.com", raw)

    def test_gmail_app_password_spaces_are_removed(self):
        self.assertEqual(smtp_password("abcd efgh ijkl mnop"), "abcdefghijklmnop")
        self.assertEqual(smtp_password('"abcd efgh ijkl mnop"'), "abcdefghijklmnop")

    def test_login_prefers_smtp_user_over_a_different_username(self):
        self.assertEqual(
            smtp_login_users("host@jodevents.com", "old@gmail.com"),
            ["host@jodevents.com", "old@gmail.com"],
        )
        self.assertEqual(smtp_login_users("", "only@gmail.com"), ["only@gmail.com"])

    def test_zepto_signs_in_as_emailapikey(self):
        self.assertEqual(
            smtp_login_users("emailapikey", "AKIAYBP4ODGMRVPBBYY5", "smtp.zeptomail.in"),
            ["emailapikey"],
        )
        self.assertEqual(smtp_login_users("", "", "smtp.zeptomail.com"), ["emailapikey"])

    def test_footer_logo_is_embedded_not_a_remote_image(self):
        logo = email_logo_bytes()
        self.assertTrue(logo and logo.startswith(b"\x89PNG"))
        html = wrap_html_body("<p>You're invited to the admin portal.</p>", f"cid:{LOGO_CID}")
        self.assertIn(f'src="cid:{LOGO_CID}"', html)
        self.assertNotIn("https://jodevents.com/images/", html)
        part = html_message_part("plain", html, logo)
        raw = part.as_string()
        self.assertIn(f"Content-ID: <{LOGO_CID}>", raw)
        self.assertIn("Content-Disposition: inline", raw)
        packed = zepto_inline_images([(LOGO_CID, logo, "image/png")])
        self.assertEqual(packed[0]["cid"], LOGO_CID)
        self.assertEqual(packed[0]["mime_type"], "image/png")
        self.assertTrue(packed[0]["content"])

    def test_zepto_india_api_uses_the_token_prefix(self):
        self.assertEqual(zepto_api_url("smtp.zeptomail.in"), "https://api.zeptomail.in/v1.1/email")
        self.assertTrue(zepto_authorization("abc").startswith("Zoho-enczapikey "))
        self.assertIn("credits", zepto_send_failure(429, '{"error":{"code":"LE_102","message":"Credit exhausted"}}').lower())


if __name__ == "__main__":
    unittest.main()
