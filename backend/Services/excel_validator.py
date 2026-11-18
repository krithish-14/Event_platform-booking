"""Validate Smart Data Mapping uploads (extension, signature, size, limits)."""

from __future__ import annotations

import os
from typing import Optional, Tuple

MAX_UPLOAD_BYTES = int(os.getenv("DATA_MAPPING_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)) or str(10 * 1024 * 1024))
MAX_ROWS = int(os.getenv("DATA_MAPPING_MAX_ROWS", "50000") or "50000")
MAX_COLUMNS = int(os.getenv("DATA_MAPPING_MAX_COLUMNS", "100") or "100")

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}
ALLOWED_MIME = {
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel",
	"text/csv",
	"application/csv",
	"text/plain",
	"application/octet-stream",
}

# ZIP (xlsx), OLE (xls), plain text BOM / printable (csv)
_XLSX_SIG = b"PK\x03\x04"
_XLS_SIG = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


class ExcelValidationError(ValueError):
	pass


def _ext(filename: str) -> str:
	name = (filename or "").strip().lower()
	dot = name.rfind(".")
	return name[dot:] if dot >= 0 else ""


def validate_upload(
	*,
	filename: str,
	content_type: Optional[str],
	data: bytes,
) -> Tuple[str, str]:
	"""Return (extension, normalized_mime). Raises ExcelValidationError."""
	if not data:
		raise ExcelValidationError("Empty file.")
	if len(data) > MAX_UPLOAD_BYTES:
		raise ExcelValidationError(f"File exceeds maximum size of {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")

	ext = _ext(filename)
	if ext not in ALLOWED_EXTENSIONS:
		raise ExcelValidationError("Unsupported file type. Use .xlsx, .xls, or .csv.")

	mime = (content_type or "").split(";")[0].strip().lower() or "application/octet-stream"
	if mime and mime not in ALLOWED_MIME:
		# Some browsers send odd MIME for CSV/XLS — signature check is authoritative.
		pass

	head = data[:8]
	if ext == ".xlsx":
		if not data.startswith(_XLSX_SIG):
			raise ExcelValidationError("File signature does not match a valid .xlsx workbook.")
		mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	elif ext == ".xls":
		if not data.startswith(_XLS_SIG):
			raise ExcelValidationError("File signature does not match a valid .xls workbook.")
		mime = "application/vnd.ms-excel"
	elif ext == ".csv":
		# Reject binary OLE/ZIP disguised as CSV
		if data.startswith(_XLSX_SIG) or data.startswith(_XLS_SIG):
			raise ExcelValidationError("File content does not match a CSV text file.")
		mime = "text/csv"

	return ext, mime


def enforce_sheet_limits(row_count: int, column_count: int) -> None:
	if column_count > MAX_COLUMNS:
		raise ExcelValidationError(f"Worksheet has too many columns (max {MAX_COLUMNS}).")
	if row_count > MAX_ROWS:
		raise ExcelValidationError(f"Worksheet has too many rows (max {MAX_ROWS}).")
