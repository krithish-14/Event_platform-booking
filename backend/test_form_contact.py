"""Ticket name / email / phone from registration-form answers, whatever order the keys come back in."""
import unittest

from APIs.admin import _form_guest_identity
from Utils.form_contact import form_contact, mask_email, mask_phone, name_label_rank

# Postgres JSONB returns keys shortest-first, so "Club Name" comes before "Rotarian Name".
ROTARY_ANSWERS = {
    "Position": "Rotarian",
    "Club Name": "Chennai Galaxy",
    "Email Address": "ravi.kumar@example.com",
    "Rotarian Name": "Ravi Kumar",
    "Mobile Phone Number": "9876543210",
    "Number of Participants": "1",
    "_ticket_type": "General Pass",
}


class FormContact(unittest.TestCase):
    def test_person_name_beats_club_name_in_any_order(self):
        self.assertEqual(form_contact(ROTARY_ANSWERS), ("Ravi Kumar", "ravi.kumar@example.com", "9876543210"))
        reversed_order = dict(reversed(list(ROTARY_ANSWERS.items())))
        self.assertEqual(form_contact(reversed_order)[0], "Ravi Kumar")

    def test_ticket_identity_uses_the_same_rules(self):
        self.assertEqual(_form_guest_identity(ROTARY_ANSWERS), ("Ravi Kumar", "ravi.kumar@example.com", "9876543210"))

    def test_recorded_contact_keys_win(self):
        answers = dict(ROTARY_ANSWERS, _contact_name="Dr. Ravi Kumar", _contact_phone="+91 90000 11111")
        name, _email, phone = form_contact(answers)
        self.assertEqual((name, phone), ("Dr. Ravi Kumar", "+91 90000 11111"))

    def test_label_ranking(self):
        self.assertLess(name_label_rank("Full Name"), name_label_rank("Rotarian Name"))
        self.assertLess(name_label_rank("Rotarian Name"), name_label_rank("Last Name"))
        self.assertLess(name_label_rank("Last Name"), name_label_rank("Company Name"))
        self.assertEqual(name_label_rank("Email Address"), 99)

    def test_group_name_is_only_a_last_resort(self):
        self.assertEqual(form_contact({"Team Name": "Blue Sharks", "Email": "a@b.co"})[0], "Blue Sharks")

    def test_masking(self):
        self.assertEqual(mask_email("ravi.kumar@example.com"), "ra\u2022\u2022\u2022@example.com")
        self.assertEqual(mask_phone("+91 98765 43210"), "91\u2022\u2022\u2022\u2022\u2022\u2022\u2022210")
        self.assertEqual(mask_phone("N/A"), "")
        self.assertEqual(mask_email(""), "")


if __name__ == "__main__":
    unittest.main()
