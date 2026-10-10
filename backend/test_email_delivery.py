import unittest
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from Services.email import envelope_address, smtp_message_bytes, wrap_text_body


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


if __name__ == "__main__":
    unittest.main()
