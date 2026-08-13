"""
ID Generator Utilities for Customer IDs (CUST-669567) and Host IDs (HST-669567).
"""
import random
import re


def generate_numeric_code() -> str:
    """Generate a random 6-digit string."""
    return str(random.randint(100000, 999999))


def generate_customer_id() -> str:
    """Generate a new Customer ID in the format CUST-XXXXXX."""
    return f"CUST-{generate_numeric_code()}"


def generate_host_id_from_customer_id(customer_id: str | None) -> str:
    """
    Generate a Host ID matching the Customer ID number.
    e.g. CUST-669567 -> HST-669567
    """
    if customer_id and customer_id.startswith("CUST-"):
        code = customer_id.replace("CUST-", "")
        return f"HST-{code}"
    match = re.search(r"\d{6}", customer_id or "")
    if match:
        return f"HST-{match.group(0)}"
    return f"HST-{generate_numeric_code()}"
