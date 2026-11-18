"""Unit tests for Smart Data Mapping Excel + relationship engine."""

from __future__ import annotations

import io
import unittest

from Services.excel_reader import (
	load_workbook_view,
	normalize_key,
	unique_values_for_column,
	validate_selection_path,
)
from Services.excel_validator import ExcelValidationError, validate_upload
from Services.relationship_engine import would_create_cycle


def _csv_bytes(text: str) -> bytes:
	return text.encode("utf-8")


SAMPLE_CSV = """District,Club Name,Member Name
3233,Chennai Central,Arun Kumar
3233,Chennai Central,Rahul
3233,Chennai North,Priya
3234,Coimbatore,Karthik
3234,Coimbatore,Sanjay
3235,Madurai,Manoj
"""


class ExcelValidatorTests(unittest.TestCase):
	def test_reject_bad_extension(self):
		with self.assertRaises(ExcelValidationError):
			validate_upload(filename="x.exe", content_type="application/octet-stream", data=b"MZ")

	def test_accept_csv(self):
		ext, mime = validate_upload(filename="a.csv", content_type="text/csv", data=_csv_bytes(SAMPLE_CSV))
		self.assertEqual(ext, ".csv")
		self.assertEqual(mime, "text/csv")


class ExcelReaderTests(unittest.TestCase):
	def setUp(self):
		self.view = load_workbook_view(_csv_bytes(SAMPLE_CSV), "members.csv")

	def test_columns_detected(self):
		names = [c.name for c in self.view.columns]
		self.assertEqual(names, ["District", "Club Name", "Member Name"])

	def test_district_filter_clubs(self):
		opts, total = unique_values_for_column(
			self.view,
			"Club Name",
			filters={"District": "3233"},
			sort_order="alpha_asc",
		)
		self.assertEqual(total, 2)
		self.assertEqual(opts, ["Chennai Central", "Chennai North"])

	def test_club_filter_members(self):
		opts, total = unique_values_for_column(
			self.view,
			"Member Name",
			filters={"District": "3233", "Club Name": "Chennai Central"},
		)
		self.assertEqual(sorted(opts), ["Arun Kumar", "Rahul"])
		self.assertEqual(total, 2)

	def test_duplicate_club_name_scoped_by_district(self):
		# Coimbatore only under 3234
		opts, _ = unique_values_for_column(
			self.view,
			"Club Name",
			filters={"District": "3234"},
		)
		self.assertEqual(opts, ["Coimbatore"])

	def test_validate_full_path(self):
		ok = validate_selection_path(
			self.view,
			[
				("District", "3233"),
				("Club Name", "Chennai Central"),
				("Member Name", "Rahul"),
			],
		)
		self.assertTrue(ok)
		bad = validate_selection_path(
			self.view,
			[
				("District", "3233"),
				("Club Name", "Coimbatore"),
				("Member Name", "Karthik"),
			],
		)
		self.assertFalse(bad)

	def test_normalize_key(self):
		self.assertEqual(normalize_key("  Chennai   Central "), "chennai central")

	def test_numeric_twins_dedupe(self):
		csv = "District,Club\n3233,A\n3233.0,A\n3233,B\n"
		view = load_workbook_view(_csv_bytes(csv), "d.csv")
		opts, total = unique_values_for_column(view, "District", sort_order="num_asc")
		self.assertEqual(total, 1)
		self.assertEqual(opts, ["3233"])

	def test_unfiltered_clubs_are_unique(self):
		opts, total = unique_values_for_column(self.view, "Club Name")
		self.assertEqual(total, 4)
		self.assertEqual(len(opts), len(set(opts)))

	def test_member_not_leaked_across_clubs(self):
		opts, total = unique_values_for_column(
			self.view,
			"Member Name",
			filters={"Club Name": "Chennai Central"},
		)
		self.assertEqual(total, 2)
		self.assertNotIn("Priya", opts)
		self.assertNotIn("Karthik", opts)


class RelationshipEngineTests(unittest.TestCase):
	def test_cycle_detection(self):
		edges = [("a", "b"), ("b", "c")]
		self.assertTrue(would_create_cycle(edges, "c", "a"))
		self.assertFalse(would_create_cycle(edges, "a", "d"))
		self.assertTrue(would_create_cycle([], "x", "x"))


if __name__ == "__main__":
	unittest.main()
