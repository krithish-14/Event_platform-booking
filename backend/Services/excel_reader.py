"""Read Excel/CSV workbooks for Smart Data Mapping (pandas + openpyxl)."""

from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from Services.excel_validator import ExcelValidationError, enforce_sheet_limits, validate_upload

_FORMULA_PREFIX = re.compile(r"^[=+\-@]")


@dataclass
class ColumnMeta:
	name: str
	index: int
	data_type: str
	unique_count: int
	empty: bool
	duplicate_header: bool


@dataclass
class WorkbookView:
	file_hash: str
	sheet_names: List[str]
	active_sheet: str
	columns: List[ColumnMeta]
	preview_rows: List[Dict[str, Any]]
	# list of row dicts keyed by original column name (display values)
	rows: List[Dict[str, Any]] = field(default_factory=list)
	# parallel normalized keys per cell for filtering
	norm_rows: List[Dict[str, str]] = field(default_factory=list)


def file_hash(data: bytes) -> str:
	return hashlib.sha256(data).hexdigest()


def normalize_key(value: Any) -> str:
	"""Comparison key — trim, collapse whitespace, unify numeric twins, casefold."""
	if value is None:
		return ""
	if isinstance(value, bool):
		return "1" if value else "0"
	if isinstance(value, int) and not isinstance(value, bool):
		return str(value)
	if isinstance(value, float):
		if value.is_integer():
			return str(int(value))
		return str(value)
	text = str(value).replace("\u00a0", " ").strip()
	text = re.sub(r"\s+", " ", text)
	if not text:
		return ""
	# Unify 3233 / 3233.0 / 3,233 so parent filters and dedupe match
	try:
		num = float(text.replace(",", ""))
		if num.is_integer():
			return str(int(num))
		return str(num)
	except (TypeError, ValueError):
		pass
	return text.casefold()


def display_value(value: Any) -> str:
	if value is None:
		return ""
	if isinstance(value, bool):
		return "Yes" if value else "No"
	if isinstance(value, int) and not isinstance(value, bool):
		return str(value)
	if isinstance(value, float):
		if value.is_integer():
			return str(int(value))
		return str(value)
	text = str(value).replace("\u00a0", " ").strip()
	text = re.sub(r"\s+", " ", text)
	# Prefer clean integer strings over "3233.0"
	try:
		num = float(text.replace(",", ""))
		if num.is_integer():
			text = str(int(num))
	except (TypeError, ValueError):
		pass
	# Guard against formula injection when values are later exported
	if _FORMULA_PREFIX.match(text):
		return "'" + text
	return text


def _infer_type(series_values: Sequence[Any]) -> str:
	non_empty = [v for v in series_values if display_value(v) != ""]
	if not non_empty:
		return "empty"
	numeric = 0
	for v in non_empty:
		try:
			float(str(v).replace(",", ""))
			numeric += 1
		except (TypeError, ValueError):
			pass
	if numeric == len(non_empty):
		return "number"
	return "string"


def _read_dataframe(data: bytes, filename: str, sheet_name: Optional[str]):
	import pandas as pd

	ext, _mime = validate_upload(filename=filename, content_type=None, data=data)
	bio = io.BytesIO(data)
	if ext == ".csv":
		df = pd.read_csv(bio, dtype=object, keep_default_na=False)
		sheets = ["Sheet1"]
		active = "Sheet1"
	elif ext == ".xls":
		# xlrd engine for legacy .xls
		xl = pd.ExcelFile(bio, engine="xlrd")
		sheets = list(xl.sheet_names)
		active = sheet_name if sheet_name in sheets else sheets[0]
		df = xl.parse(active, dtype=object, keep_default_na=False)
	else:
		xl = pd.ExcelFile(bio, engine="openpyxl")
		sheets = list(xl.sheet_names)
		active = sheet_name if sheet_name in sheets else sheets[0]
		df = xl.parse(active, dtype=object, keep_default_na=False)
	return df, sheets, active


def list_sheet_names(data: bytes, filename: str) -> List[str]:
	import pandas as pd

	ext, _ = validate_upload(filename=filename, content_type=None, data=data)
	bio = io.BytesIO(data)
	if ext == ".csv":
		return ["Sheet1"]
	engine = "xlrd" if ext == ".xls" else "openpyxl"
	xl = pd.ExcelFile(bio, engine=engine)
	return list(xl.sheet_names)


def load_workbook_view(
	data: bytes,
	filename: str,
	sheet_name: Optional[str] = None,
	preview_limit: int = 20,
) -> WorkbookView:
	df, sheets, active = _read_dataframe(data, filename, sheet_name)
	enforce_sheet_limits(len(df.index), len(df.columns))

	raw_headers = [display_value(c) if display_value(c) else f"Column_{i+1}" for i, c in enumerate(df.columns)]
	# Deduplicate header labels for dict keys while preserving index metadata
	seen: Dict[str, int] = {}
	headers: List[str] = []
	dup_flags: List[bool] = []
	for h in raw_headers:
		base = h
		count = seen.get(base, 0)
		seen[base] = count + 1
		dup_flags.append(count > 0 or raw_headers.count(base) > 1)
		if count:
			headers.append(f"{base}__{count+1}")
		else:
			headers.append(base)

	df.columns = headers
	columns: List[ColumnMeta] = []
	for idx, name in enumerate(headers):
		col_vals = list(df.iloc[:, idx].tolist())
		displays = [display_value(v) for v in col_vals]
		non_empty = [d for d in displays if d]
		columns.append(
			ColumnMeta(
				name=name,
				index=idx,
				data_type=_infer_type(col_vals),
				unique_count=len(set(normalize_key(v) for v in non_empty)),
				empty=len(non_empty) == 0,
				duplicate_header=dup_flags[idx],
			)
		)

	rows: List[Dict[str, Any]] = []
	norm_rows: List[Dict[str, str]] = []
	for _, series in df.iterrows():
		row: Dict[str, Any] = {}
		norm: Dict[str, str] = {}
		blank = True
		for name in headers:
			disp = display_value(series[name])
			row[name] = disp
			norm[name] = normalize_key(disp)
			if disp:
				blank = False
		if blank:
			continue
		rows.append(row)
		norm_rows.append(norm)

	preview = rows[: max(1, min(preview_limit, 50))]
	return WorkbookView(
		file_hash=file_hash(data),
		sheet_names=sheets,
		active_sheet=active,
		columns=columns,
		preview_rows=preview,
		rows=rows,
		norm_rows=norm_rows,
	)


def unique_values_for_column(
	view: WorkbookView,
	column_name: str,
	*,
	filters: Optional[Dict[str, str]] = None,
	sort_order: str = "alpha_asc",
	search: Optional[str] = None,
	offset: int = 0,
	limit: int = 100,
) -> Tuple[List[str], int]:
	"""Return unique display values for a column, filtered by parent column=value pairs.

	Duplicates are removed by normalized key (case/spacing/numeric twins).
	Parent filters must all match on the same Excel row (primary-key style).
	"""
	filters = filters or {}
	norm_filters = {col: normalize_key(val) for col, val in filters.items() if col}
	seen_keys: set[str] = set()
	ordered: List[str] = []
	search_n = normalize_key(search) if search else ""

	for row, norm in zip(view.rows, view.norm_rows):
		ok = True
		for parent_col, parent_key in norm_filters.items():
			if parent_key != norm.get(parent_col, ""):
				ok = False
				break
		if not ok:
			continue
		disp = display_value(row.get(column_name, ""))
		key = normalize_key(disp) or norm.get(column_name, "")
		if not key:
			continue
		if search_n and search_n not in key:
			continue
		if key in seen_keys:
			continue
		seen_keys.add(key)
		ordered.append(disp)

	ordered = _sort_values(ordered, sort_order)
	total = len(ordered)
	offset = max(0, int(offset or 0))
	limit = max(1, min(int(limit or 100), 2000))
	return ordered[offset : offset + limit], total


def _sort_values(values: List[str], sort_order: str) -> List[str]:
	order = (sort_order or "alpha_asc").lower()

	def num_key(v: str):
		key = normalize_key(v)
		try:
			return (0, float(key.replace(",", "")))
		except (TypeError, ValueError):
			return (1, key)

	if order == "alpha_desc":
		return sorted(values, key=normalize_key, reverse=True)
	if order == "num_asc":
		return sorted(values, key=num_key)
	if order == "num_desc":
		return sorted(values, key=num_key, reverse=True)
	return sorted(values, key=normalize_key)


def validate_selection_path(
	view: WorkbookView,
	chain: Sequence[Tuple[str, str]],
) -> bool:
	"""
	chain: ordered [(column_name, selected_display_value), ...] from root to leaf.
	True if at least one Excel row matches the full hierarchy.
	"""
	if not chain:
		return False
	for norm in view.norm_rows:
		ok = True
		for col, val in chain:
			if norm.get(col, "") != normalize_key(val):
				ok = False
				break
		if ok:
			return True
	return False
