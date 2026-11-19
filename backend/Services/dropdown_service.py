"""Load Excel sources, serve filtered dropdown options, validate answers."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from Models.registration_data_mapping import (
	RegistrationDataColumn,
	RegistrationDataMapping,
	RegistrationDataRelationship,
	RegistrationDataSource,
)
from Models.stored_file import StoredFile
from Services import file_storage
from Services.excel_cache import cache_get, cache_invalidate, cache_key_for_source, cache_set
from Services.excel_reader import (
	WorkbookView,
	load_workbook_view,
	unique_values_for_column,
	validate_selection_path,
)
from Services.relationship_engine import ancestor_chain, build_parent_map

logger = logging.getLogger(__name__)


class DropdownServiceError(Exception):
	def __init__(self, message: str, status_code: int = 400):
		super().__init__(message)
		self.status_code = status_code
		self.message = message


def _load_file_bytes(db: Session, source: RegistrationDataSource) -> Tuple[bytes, str]:
	if source.stored_file_id:
		stored = db.query(StoredFile).filter(StoredFile.id == source.stored_file_id).first()
		if not stored:
			raise DropdownServiceError("Excel source file is missing.", 404)
		data = file_storage.decrypt_bytes(stored.encrypted_data)
		return data, stored.original_filename or source.file_name
	raise DropdownServiceError("Excel source has no stored file.", 404)


def get_workbook_view(db: Session, source: RegistrationDataSource, *, force: bool = False) -> WorkbookView:
	if not source.sheet_name:
		raise DropdownServiceError("Select a worksheet before using this source.", 400)
	key = cache_key_for_source(str(source.id), source.file_hash or "", source.sheet_name or "")
	if not force:
		cached = cache_get(key)
		if cached is not None:
			return cached
	data, filename = _load_file_bytes(db, source)
	view = load_workbook_view(data, filename, sheet_name=source.sheet_name)
	cache_set(key, view)
	return view


def invalidate_source_cache(source: RegistrationDataSource) -> None:
	cache_invalidate(f"sdm:{source.id}:")


def active_source_for_event(db: Session, event_id) -> Optional[RegistrationDataSource]:
	return (
		db.query(RegistrationDataSource)
		.filter(
			RegistrationDataSource.event_id == event_id,
			RegistrationDataSource.status.in_(("active", "configured")),
		)
		.order_by(RegistrationDataSource.updated_at.desc())
		.first()
	)


def mappings_for_source(db: Session, source_id) -> List[RegistrationDataMapping]:
	return (
		db.query(RegistrationDataMapping)
		.filter(
			RegistrationDataMapping.source_id == source_id,
			RegistrationDataMapping.is_active.is_(True),
		)
		.all()
	)


def relationships_for_source(db: Session, source_id) -> List[RegistrationDataRelationship]:
	return (
		db.query(RegistrationDataRelationship)
		.filter(
			RegistrationDataRelationship.source_id == source_id,
			RegistrationDataRelationship.is_active.is_(True),
		)
		.all()
	)


def column_name_map(db: Session, source_id) -> Dict[str, str]:
	"""mapping_id -> excel column name"""
	rows = (
		db.query(RegistrationDataMapping, RegistrationDataColumn)
		.join(RegistrationDataColumn, RegistrationDataColumn.id == RegistrationDataMapping.column_id)
		.filter(RegistrationDataMapping.source_id == source_id)
		.all()
	)
	return {str(m.id): c.column_name for m, c in rows}


def question_mapping_map(db: Session, source_id) -> Dict[str, RegistrationDataMapping]:
	return {m.question_id: m for m in mappings_for_source(db, source_id)}


def options_for_question(
	db: Session,
	*,
	source: RegistrationDataSource,
	question_id: str,
	parent_answers: Optional[Dict[str, str]] = None,
	search: Optional[str] = None,
	offset: int = 0,
	limit: int = 100,
) -> Dict[str, Any]:
	"""
	parent_answers: { question_id: selected_value } for ancestor fields.
	"""
	qmap = question_mapping_map(db, source.id)
	mapping = qmap.get(question_id)
	if not mapping:
		raise DropdownServiceError("Field is not connected to an Excel column.", 404)

	rels = relationships_for_source(db, source.id)
	parent_map = build_parent_map(rels)
	col_by_mapping = column_name_map(db, source.id)
	view = get_workbook_view(db, source)

	filters: Dict[str, str] = {}
	ancestors = ancestor_chain(str(mapping.id), parent_map)
	parent_answers = parent_answers or {}

	def _answer_for_mapping(parent_m: RegistrationDataMapping) -> str:
		"""Resolve parent value from question id or loose title/id keys."""
		qid = parent_m.question_id
		raw = parent_answers.get(qid)
		if raw is None or str(raw).strip() == "":
			for key, val in parent_answers.items():
				if key == qid or str(key).endswith(str(qid)) or str(qid) in str(key):
					if val is not None and str(val).strip() != "":
						return str(val).strip()
			return ""
		return str(raw).strip()

	# Only require ancestors that are actually mapped as form questions.
	# Ignore orphan relationship links (e.g. District→Club) when District is not on the form.
	missing = []
	for parent_mid in ancestors:
		parent_m = next((m for m in qmap.values() if str(m.id) == parent_mid), None)
		if not parent_m:
			continue
		val = _answer_for_mapping(parent_m)
		if not val:
			missing.append(parent_m.question_id)
		else:
			col = col_by_mapping.get(parent_mid)
			if col:
				filters[col] = val

	if missing:
		return {
			"options": [],
			"total": 0,
			"disabled": True,
			"missing_parents": missing,
			"sort_order": mapping.sort_order,
			"is_searchable": mapping.is_searchable,
			"placeholder": mapping.placeholder,
			"source_version_hash": source.file_hash,
		}

	col_name = col_by_mapping.get(str(mapping.id))
	if not col_name:
		raise DropdownServiceError("Mapped column is missing.", 400)

	# Prefer relationship sort for child fields when set; else mapping sort
	sort_order = mapping.sort_order or "alpha_asc"
	for rel in rels:
		if str(rel.child_mapping_id) == str(mapping.id) and getattr(rel, "sort_order", None):
			sort_order = rel.sort_order or sort_order
			break

	options, total = unique_values_for_column(
		view,
		col_name,
		filters=filters,
		sort_order=sort_order,
		search=search,
		offset=offset,
		limit=limit,
	)
	return {
		"options": options,
		"total": total,
		"disabled": False,
		"missing_parents": [],
		"filtered_by": filters,
		"column": col_name,
		"sort_order": sort_order,
		"is_searchable": mapping.is_searchable,
		"placeholder": mapping.placeholder,
		"source_version_hash": source.file_hash,
	}


def validate_mapped_answers(
	db: Session,
	*,
	event_id,
	answers: Dict[str, Any],
	expected_hash: Optional[str] = None,
) -> None:
	"""Raise DropdownServiceError if Excel-mapped answers are invalid."""
	source = active_source_for_event(db, event_id)
	if not source:
		return
	if source.status not in ("active", "configured"):
		return

	qmap = question_mapping_map(db, source.id)
	if not qmap:
		return

	if expected_hash and source.file_hash and expected_hash != source.file_hash:
		raise DropdownServiceError(
			"The registration data file was updated. Please refresh and select values again.",
			409,
		)

	rels = relationships_for_source(db, source.id)
	parent_map = build_parent_map(rels)
	col_by_mapping = column_name_map(db, source.id)
	view = get_workbook_view(db, source)

	# Collect selected mapped values by question id (answers may use title or id keys)
	selected: Dict[str, str] = {}
	for qid, mapping in qmap.items():
		val = _answer_for_question(answers, qid)
		if val is None or str(val).strip() == "":
			continue
		selected[qid] = str(val).strip()

	for qid, mapping in qmap.items():
		if qid not in selected:
			continue
		ancestors = ancestor_chain(str(mapping.id), parent_map)
		chain: List[Tuple[str, str]] = []
		for parent_mid in ancestors:
			parent_m = next((m for m in qmap.values() if str(m.id) == parent_mid), None)
			if not parent_m:
				continue
			pval = selected.get(parent_m.question_id)
			if not pval:
				raise DropdownServiceError(
					f"Select a value for the parent field before '{qid}'.",
					400,
				)
			chain.append((col_by_mapping[parent_mid], pval))
		chain.append((col_by_mapping[str(mapping.id)], selected[qid]))
		if not validate_selection_path(view, chain):
			raise DropdownServiceError(
				"One or more dropdown selections are not valid for the uploaded data.",
				400,
			)


def _answer_for_question(answers: Dict[str, Any], question_id: str) -> Any:
	if question_id in answers:
		return answers[question_id]
	# published form often keys as "Title (question_id)" or similar — scan
	for key, val in answers.items():
		if key == question_id or key.endswith(f"({question_id})") or key.endswith(f"_{question_id}"):
			return val
		if str(key).startswith(f"{question_id}") or str(key).endswith(str(question_id)):
			return val
	return None


def parse_uuid(value) -> Optional[UUID]:
	try:
		return UUID(str(value))
	except Exception:
		return None
