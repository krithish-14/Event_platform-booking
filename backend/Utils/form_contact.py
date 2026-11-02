"""
Attendee name / email / phone from registration-form answers.

Answers are keyed by question title. Postgres JSON does not keep the form's question
order, so "the first question with 'name' in it" can land on "Club Name" instead of
"Rotarian Name". Name questions are ranked by what they describe instead, and the
published form also records the contact answers it picked as _contact_* keys.
"""

import re
from typing import Any, Tuple

CONTACT_NAME_KEY = "_contact_name"
CONTACT_EMAIL_KEY = "_contact_email"
CONTACT_PHONE_KEY = "_contact_phone"

_EXACT_NAME_LABELS = {
    "name", "full name", "fullname", "full_name", "your name", "attendee name", "attendee",
    "participant name", "guest name", "first name", "first_name", "attendee_name",
}
# Labels that name a person, not a group or a thing.
_PERSON_WORDS = (
    "full", "your", "attendee", "participant", "guest", "delegate", "member", "rotarian",
    "rotaractor", "student", "player", "applicant", "candidate", "visitor", "speaker",
    "volunteer", "registrant", "first", "person", "holder", "passenger",
)
_NOT_ATTENDEE_WORDS = (
    "club", "company", "organisation", "organization", "org name", "institution", "institute",
    "college", "school", "university", "business", "firm", "team", "district", "zone",
    "chapter", "branch", "father", "mother", "spouse", "husband", "wife", "guardian", "parent",
    "emergency", "nominee", "reference", "user", "bank", "file", "event", "ticket", "pass",
    "brand", "shop", "store", "group", "society", "association", "department", "designation",
    "city", "venue", "hotel", "project", "product", "pet", "vehicle", "account",
)
_SECONDARY_NAME_WORDS = ("last", "surname", "middle", "nick", "family")


def _label(key: Any) -> str:
    return re.sub(r"[\s_]+", " ", str(key or "")).strip().lower()


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    if isinstance(value, dict):
        return ", ".join(str(v).strip() for v in value.values() if str(v).strip())
    return str(value).strip()


def _visible(answers: Any):
    if not isinstance(answers, dict):
        return []
    return [(k, v) for k, v in answers.items() if not str(k).startswith("_")]


def name_label_rank(label: str) -> int:
    """Lower is better. 9 = only a group/thing name (used as a last resort)."""
    label = _label(label)
    if "name" not in label and label != "attendee":
        return 99
    if any(word in label for word in _NOT_ATTENDEE_WORDS):
        return 9
    if label in _EXACT_NAME_LABELS:
        return 0
    if any(word in label for word in _SECONDARY_NAME_WORDS):
        return 5
    if any(word in label for word in _PERSON_WORDS):
        return 1
    return 3


def pick_attendee_name(answers: Any) -> str:
    if isinstance(answers, dict):
        explicit = _text(answers.get(CONTACT_NAME_KEY))
        if explicit:
            return explicit
    best = None
    for index, (key, value) in enumerate(_visible(answers)):
        rank = name_label_rank(key)
        if rank >= 99:
            continue
        text = _text(value)
        if not text or any(tok in text.lower() for tok in ("pass", "ticket", "general admission")):
            continue
        if best is None or (rank, index) < best[:2]:
            best = (rank, index, text)
    return best[2] if best else ""


def pick_attendee_email(answers: Any) -> str:
    if isinstance(answers, dict):
        explicit = _text(answers.get(CONTACT_EMAIL_KEY))
        if explicit and "@" in explicit:
            return explicit
    rows = _visible(answers)
    for key, value in rows:
        label = _label(key)
        text = _text(value)
        if text and "@" in text and any(w in label for w in ("email", "e mail", "e-mail", "mail")):
            return text
    for _key, value in rows:
        text = _text(value)
        if re.fullmatch(r"[^@\s,]+@[^@\s,]+\.[^@\s,]+", text or ""):
            return text
    return ""


def pick_attendee_phone(answers: Any) -> str:
    if isinstance(answers, dict):
        explicit = _text(answers.get(CONTACT_PHONE_KEY))
        if explicit:
            return explicit
    for key, value in _visible(answers):
        label = _label(key)
        if any(w in label for w in ("phone", "mobile", "whatsapp", "contact number", "cell")):
            text = _text(value)
            if text:
                return text
    return ""


def form_contact(answers: Any) -> Tuple[str, str, str]:
    return pick_attendee_name(answers), pick_attendee_email(answers), pick_attendee_phone(answers)


def mask_email(email: str) -> str:
    email = str(email or "").strip()
    if "@" not in email:
        return ""
    user, domain = email.split("@", 1)
    shown = user[:2] if len(user) > 2 else user[:1]
    return shown + "\u2022\u2022\u2022@" + domain


def mask_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) < 6:
        return ""
    dots = "\u2022" * (len(digits) - 5)
    return digits[:2] + dots + digits[-3:]
