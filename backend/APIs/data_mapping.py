"""
Smart Data Mapping Engine — admin Excel config + public dependent dropdowns.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.base import get_db
from Models.event_management import EventManagement
from Models.event_registration_forms import EventRegistrationForm
from Models.form_definitions import FormDefinition
from Models.registration_data_mapping import (
	RegistrationDataColumn,
	RegistrationDataMapping,
	RegistrationDataRelationship,
	RegistrationDataSource,
	RegistrationDataSourceVersion,
)
from Models.user import User
from Services import file_storage
from Services.dropdown_service import (
	DropdownServiceError,
	active_source_for_event,
	get_workbook_view,
	invalidate_source_cache,
	mappings_for_source,
	options_for_question,
	question_mapping_map,
	relationships_for_source,
)
from Services.excel_reader import file_hash, list_sheet_names, load_workbook_view
from Services.excel_validator import ExcelValidationError, validate_upload
from Services.relationship_engine import would_create_cycle
from APIs.host_events_api import resolve_host_identifiers, _event_owned

logger = logging.getLogger(__name__)

admin_router = APIRouter(prefix="/api/data-mapping", tags=["Smart Data Mapping"])
public_router = APIRouter(prefix="/api/registration", tags=["Registration Data Mapping"])


# ── Schemas ─────────────────────────────────────────────────


class SheetSelectRequest(BaseModel):
	sheet_name: str


class MappingItem(BaseModel):
	question_id: str
	column_id: str
	field_type: str = "dropdown"
	sort_order: str = "alpha_asc"
	is_searchable: bool = True
	placeholder: Optional[str] = None
	is_active: bool = True


class ConfigureRequest(BaseModel):
	form_definition_id: Optional[int] = None
	host_form_id: Optional[str] = None
	mappings: List[MappingItem] = Field(default_factory=list)
	activate: bool = False


class RelationshipItem(BaseModel):
	parent_mapping_id: str
	child_mapping_id: str
	relationship_type: str = "one_to_many"
	sort_order: str = "alpha_asc"
	is_active: bool = True


class RelationshipsRequest(BaseModel):
	relationships: List[RelationshipItem] = Field(default_factory=list)


class RelationshipUpdate(BaseModel):
	parent_mapping_id: Optional[str] = None
	child_mapping_id: Optional[str] = None
	relationship_type: Optional[str] = None
	sort_order: Optional[str] = None
	is_active: Optional[bool] = None


# ── Auth helpers ────────────────────────────────────────────


def _require_owned_source(db: Session, source_id: str, user: User) -> RegistrationDataSource:
	try:
		sid = UUID(str(source_id))
	except Exception:
		raise HTTPException(status_code=404, detail="Data source not found.")
	source = db.query(RegistrationDataSource).filter(RegistrationDataSource.id == sid).first()
	if not source:
		raise HTTPException(status_code=404, detail="Data source not found.")
	event = db.query(EventManagement).filter(EventManagement.event_id == source.event_id).first()
	if not event:
		raise HTTPException(status_code=404, detail="Event not found.")
	email = (user.email or "").lower().strip()
	customer_id, host_id = resolve_host_identifiers(db, email, user)
	if not _event_owned(event, email, customer_id, host_id, user):
		raise HTTPException(status_code=403, detail="You do not own this event.")
	return source


def _require_event_owner(db: Session, event_id: str, user: User) -> EventManagement:
	event = db.query(EventManagement).filter(EventManagement.event_id == event_id).first()
	if not event:
		raise HTTPException(status_code=404, detail="Event not found.")
	email = (user.email or "").lower().strip()
	customer_id, host_id = resolve_host_identifiers(db, email, user)
	if not _event_owned(event, email, customer_id, host_id, user):
		raise HTTPException(status_code=403, detail="You do not own this event.")
	return event


def _sync_columns(db: Session, source: RegistrationDataSource, view) -> None:
	db.query(RegistrationDataColumn).filter(RegistrationDataColumn.source_id == source.id).delete()
	for col in view.columns:
		db.add(
			RegistrationDataColumn(
				id=uuid4(),
				source_id=source.id,
				column_name=col.name,
				column_index=col.index,
				data_type=col.data_type,
				unique_count=col.unique_count,
				is_available=not col.empty,
			)
		)
	db.flush()


def _source_payload(db: Session, source: RegistrationDataSource) -> Dict[str, Any]:
	cols = (
		db.query(RegistrationDataColumn)
		.filter(RegistrationDataColumn.source_id == source.id)
		.order_by(RegistrationDataColumn.column_index)
		.all()
	)
	maps = mappings_for_source(db, source.id)
	rels = relationships_for_source(db, source.id)
	return {
		"id": str(source.id),
		"event_id": str(source.event_id),
		"source_name": source.source_name,
		"file_name": source.file_name,
		"file_hash": source.file_hash,
		"sheet_name": source.sheet_name,
		"status": source.status,
		"created_at": source.created_at.isoformat() if source.created_at else None,
		"updated_at": source.updated_at.isoformat() if source.updated_at else None,
		"columns": [
			{
				"id": str(c.id),
				"column_name": c.column_name,
				"column_index": c.column_index,
				"data_type": c.data_type,
				"unique_count": c.unique_count,
				"is_available": c.is_available,
			}
			for c in cols
		],
		"mappings": [
			{
				"id": str(m.id),
				"question_id": m.question_id,
				"column_id": str(m.column_id),
				"form_definition_id": m.form_definition_id,
				"host_form_id": m.host_form_id,
				"field_type": m.field_type,
				"sort_order": m.sort_order,
				"is_searchable": m.is_searchable,
				"placeholder": m.placeholder,
				"is_active": m.is_active,
			}
			for m in maps
		],
		"relationships": [
			{
				"id": str(r.id),
				"parent_mapping_id": str(r.parent_mapping_id),
				"child_mapping_id": str(r.child_mapping_id),
				"relationship_type": r.relationship_type,
				"sort_order": r.sort_order,
				"is_active": r.is_active,
			}
			for r in rels
		],
	}


# ── Admin endpoints ─────────────────────────────────────────


@admin_router.post("/upload")
async def upload_excel(
	event_id: str = Form(...),
	source_name: str = Form("Excel source"),
	file: UploadFile = File(...),
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	event = _require_event_owner(db, event_id, current_user)
	email = (current_user.email or "").lower().strip()
	customer_id, host_id = resolve_host_identifiers(db, email, current_user)

	raw = await file.read()
	filename = file.filename or "upload.xlsx"
	try:
		_ext, mime = validate_upload(filename=filename, content_type=file.content_type, data=raw)
	except ExcelValidationError as exc:
		raise HTTPException(status_code=400, detail=str(exc))

	try:
		stored = file_storage.store_data_mapping_excel(
			db,
			data=raw,
			filename=filename,
			content_type=mime,
			owner_customer_id=customer_id,
			owner_email=email,
		)
	except ValueError as exc:
		raise HTTPException(status_code=400, detail=str(exc))

	digest = file_hash(raw)
	try:
		sheets = list_sheet_names(raw, filename)
	except Exception as exc:
		logger.exception("sheet_list_failed")
		raise HTTPException(status_code=400, detail=f"Could not read workbook: {exc}")

	source = RegistrationDataSource(
		id=uuid4(),
		event_id=event.event_id,
		host_id=host_id,
		customer_id=customer_id,
		source_name=(source_name or "Excel source").strip()[:255],
		file_name=filename[:255],
		stored_file_id=stored.id,
		s3_key=None,
		file_hash=digest,
		sheet_name=None,
		status="draft",
	)
	db.add(source)
	db.flush()
	db.add(
		RegistrationDataSourceVersion(
			id=uuid4(),
			source_id=source.id,
			version_number=1,
			file_hash=digest,
			stored_file_id=stored.id,
			uploaded_by=customer_id,
			is_active=True,
		)
	)
	db.commit()
	db.refresh(source)
	return {
		"ok": True,
		"source_id": str(source.id),
		"file_name": source.file_name,
		"file_hash": digest,
		"sheets": sheets,
		"status": source.status,
	}


@admin_router.get("/event/{event_id}")
def list_sources_for_event(
	event_id: str,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	_require_event_owner(db, event_id, current_user)
	rows = (
		db.query(RegistrationDataSource)
		.filter(RegistrationDataSource.event_id == event_id)
		.order_by(RegistrationDataSource.updated_at.desc())
		.all()
	)
	return {
		"sources": [
			{
				"id": str(s.id),
				"source_name": s.source_name,
				"file_name": s.file_name,
				"sheet_name": s.sheet_name,
				"status": s.status,
				"file_hash": s.file_hash,
				"updated_at": s.updated_at.isoformat() if s.updated_at else None,
			}
			for s in rows
		]
	}


@admin_router.get("/{source_id}/sheets")
def get_sheets(
	source_id: str,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	data, filename = _bytes(db, source)
	try:
		sheets = list_sheet_names(data, filename)
	except Exception as exc:
		raise HTTPException(status_code=400, detail=str(exc))
	return {"sheets": sheets, "selected": source.sheet_name}


@admin_router.post("/{source_id}/select-sheet")
def select_sheet(
	source_id: str,
	payload: SheetSelectRequest,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	data, filename = _bytes(db, source)
	try:
		view = load_workbook_view(data, filename, sheet_name=payload.sheet_name)
	except ExcelValidationError as exc:
		raise HTTPException(status_code=400, detail=str(exc))
	except Exception as exc:
		raise HTTPException(status_code=400, detail=f"Could not read worksheet: {exc}")

	source.sheet_name = view.active_sheet
	source.updated_at = datetime.utcnow()
	if source.status == "draft":
		source.status = "configured"
	_sync_columns(db, source, view)
	invalidate_source_cache(source)
	db.commit()
	return {
		"ok": True,
		"sheet_name": source.sheet_name,
		"columns": [
			{
				"id": str(c.id),
				"column_name": c.column_name,
				"column_index": c.column_index,
				"data_type": c.data_type,
				"unique_count": c.unique_count,
				"is_available": c.is_available,
			}
			for c in db.query(RegistrationDataColumn)
			.filter(RegistrationDataColumn.source_id == source.id)
			.order_by(RegistrationDataColumn.column_index)
			.all()
		],
		"preview": view.preview_rows,
		"row_count": len(view.rows),
	}


@admin_router.get("/{source_id}/preview")
def preview(
	source_id: str,
	limit: int = Query(20, ge=1, le=50),
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	if not source.sheet_name:
		raise HTTPException(status_code=400, detail="Select a worksheet first.")
	try:
		view = get_workbook_view(db, source)
	except DropdownServiceError as exc:
		raise HTTPException(status_code=exc.status_code, detail=exc.message)
	return {
		"sheet_name": view.active_sheet,
		"preview": view.preview_rows[:limit],
		"row_count": len(view.rows),
		"columns": [c.name for c in view.columns],
	}


@admin_router.get("/{source_id}/columns")
def get_columns(
	source_id: str,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	cols = (
		db.query(RegistrationDataColumn)
		.filter(RegistrationDataColumn.source_id == source.id)
		.order_by(RegistrationDataColumn.column_index)
		.all()
	)
	return {
		"columns": [
			{
				"id": str(c.id),
				"column_name": c.column_name,
				"column_index": c.column_index,
				"data_type": c.data_type,
				"unique_count": c.unique_count,
				"is_available": c.is_available,
			}
			for c in cols
		]
	}


@admin_router.get("/{source_id}/unique-values/{column}")
def unique_values(
	source_id: str,
	column: str,
	request: Request,
	search: Optional[str] = None,
	sort_order: str = Query("alpha_asc"),
	offset: int = Query(0, ge=0),
	limit: int = Query(500, ge=1, le=2000),
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	try:
		view = get_workbook_view(db, source)
	except DropdownServiceError as exc:
		raise HTTPException(status_code=exc.status_code, detail=exc.message)
	# Accept column id or name
	col_name = column
	col_row = db.query(RegistrationDataColumn).filter(RegistrationDataColumn.id == column).first()
	if col_row and str(col_row.source_id) == str(source.id):
		col_name = col_row.column_name
	from Services.excel_reader import unique_values_for_column

	# Optional parent filters: parent_<Column Name>=value or filter_<column_id>=value
	filters: Dict[str, str] = {}
	cols_by_id = {
		str(c.id): c.column_name
		for c in db.query(RegistrationDataColumn).filter(RegistrationDataColumn.source_id == source.id).all()
	}
	for key, val in request.query_params.multi_items():
		if val is None or val == "":
			continue
		if key.startswith("parent_"):
			filters[key[7:]] = val
		elif key.startswith("filter_"):
			cid = key[7:]
			filters[cols_by_id.get(cid, cid)] = val

	opts, total = unique_values_for_column(
		view,
		col_name,
		filters=filters,
		sort_order=sort_order,
		search=search,
		offset=offset,
		limit=limit,
	)
	return {"options": opts, "total": total, "filtered_by": filters, "column": col_name}


@admin_router.post("/{source_id}/configure")
def configure_mappings(
	source_id: str,
	payload: ConfigureRequest,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	if not source.sheet_name:
		raise HTTPException(status_code=400, detail="Select a worksheet first.")

	valid_cols = {
		str(c.id)
		for c in db.query(RegistrationDataColumn).filter(RegistrationDataColumn.source_id == source.id).all()
	}
	# Clear prior mappings/relationships for this source (replace config)
	db.query(RegistrationDataRelationship).filter(RegistrationDataRelationship.source_id == source.id).delete()
	db.query(RegistrationDataMapping).filter(RegistrationDataMapping.source_id == source.id).delete()
	db.flush()

	seen_q: set = set()
	seen_c: set = set()
	for item in payload.mappings:
		if item.column_id not in valid_cols:
			raise HTTPException(status_code=400, detail=f"Unknown column_id: {item.column_id}")
		if item.question_id in seen_q:
			raise HTTPException(status_code=400, detail=f"Duplicate question mapping: {item.question_id}")
		if item.column_id in seen_c:
			raise HTTPException(status_code=400, detail=f"Duplicate column mapping: {item.column_id}")
		seen_q.add(item.question_id)
		seen_c.add(item.column_id)
		db.add(
			RegistrationDataMapping(
				id=uuid4(),
				source_id=source.id,
				form_definition_id=payload.form_definition_id,
				host_form_id=payload.host_form_id,
				question_id=item.question_id.strip(),
				column_id=UUID(item.column_id),
				field_type=item.field_type or "dropdown",
				sort_order=item.sort_order or "alpha_asc",
				is_searchable=bool(item.is_searchable),
				placeholder=item.placeholder,
				is_active=bool(item.is_active),
			)
		)
	source.status = "active" if payload.activate else "configured"
	source.updated_at = datetime.utcnow()
	invalidate_source_cache(source)
	db.commit()
	return {"ok": True, "configuration": _source_payload(db, source)}


@admin_router.post("/{source_id}/relationships")
def set_relationships(
	source_id: str,
	payload: RelationshipsRequest,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	valid_maps = {
		str(m.id): m
		for m in db.query(RegistrationDataMapping).filter(RegistrationDataMapping.source_id == source.id).all()
	}
	db.query(RegistrationDataRelationship).filter(RegistrationDataRelationship.source_id == source.id).delete()
	db.flush()

	edges: List[tuple] = []
	for item in payload.relationships:
		if item.parent_mapping_id not in valid_maps or item.child_mapping_id not in valid_maps:
			raise HTTPException(status_code=400, detail="Relationship references unknown mapping.")
		if would_create_cycle(edges, item.parent_mapping_id, item.child_mapping_id):
			raise HTTPException(status_code=400, detail="Circular relationships are not allowed.")
		edges.append((item.parent_mapping_id, item.child_mapping_id))
		db.add(
			RegistrationDataRelationship(
				id=uuid4(),
				source_id=source.id,
				parent_mapping_id=UUID(item.parent_mapping_id),
				child_mapping_id=UUID(item.child_mapping_id),
				relationship_type=item.relationship_type or "one_to_many",
				sort_order=item.sort_order or "alpha_asc",
				is_active=bool(item.is_active),
			)
		)
	source.updated_at = datetime.utcnow()
	if source.status == "draft":
		source.status = "configured"
	db.commit()
	return {"ok": True, "configuration": _source_payload(db, source)}


@admin_router.put("/{source_id}/relationships/{relationship_id}")
def update_relationship(
	source_id: str,
	relationship_id: str,
	payload: RelationshipUpdate,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	rel = (
		db.query(RegistrationDataRelationship)
		.filter(
			RegistrationDataRelationship.id == relationship_id,
			RegistrationDataRelationship.source_id == source.id,
		)
		.first()
	)
	if not rel:
		raise HTTPException(status_code=404, detail="Relationship not found.")
	if payload.parent_mapping_id is not None:
		rel.parent_mapping_id = UUID(payload.parent_mapping_id)
	if payload.child_mapping_id is not None:
		rel.child_mapping_id = UUID(payload.child_mapping_id)
	if payload.relationship_type is not None:
		rel.relationship_type = payload.relationship_type
	if payload.sort_order is not None:
		rel.sort_order = payload.sort_order
	if payload.is_active is not None:
		rel.is_active = payload.is_active
	# Cycle check
	others = (
		db.query(RegistrationDataRelationship)
		.filter(
			RegistrationDataRelationship.source_id == source.id,
			RegistrationDataRelationship.id != rel.id,
			RegistrationDataRelationship.is_active.is_(True),
		)
		.all()
	)
	edges = [(str(r.parent_mapping_id), str(r.child_mapping_id)) for r in others]
	if would_create_cycle(edges, str(rel.parent_mapping_id), str(rel.child_mapping_id)):
		db.rollback()
		raise HTTPException(status_code=400, detail="Circular relationships are not allowed.")
	db.commit()
	return {"ok": True, "configuration": _source_payload(db, source)}


@admin_router.get("/{source_id}/configuration")
def get_configuration(
	source_id: str,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	return _source_payload(db, source)


@admin_router.post("/{source_id}/refresh")
async def refresh_source(
	source_id: str,
	file: UploadFile = File(...),
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	email = (current_user.email or "").lower().strip()
	customer_id, _host_id = resolve_host_identifiers(db, email, current_user)
	raw = await file.read()
	filename = file.filename or source.file_name
	try:
		_ext, mime = validate_upload(filename=filename, content_type=file.content_type, data=raw)
	except ExcelValidationError as exc:
		raise HTTPException(status_code=400, detail=str(exc))

	stored = file_storage.store_data_mapping_excel(
		db,
		data=raw,
		filename=filename,
		content_type=mime,
		owner_customer_id=customer_id,
		owner_email=email,
	)
	digest = file_hash(raw)
	prev = (
		db.query(RegistrationDataSourceVersion)
		.filter(RegistrationDataSourceVersion.source_id == source.id)
		.order_by(RegistrationDataSourceVersion.version_number.desc())
		.first()
	)
	ver = (prev.version_number if prev else 0) + 1
	if prev:
		prev.is_active = False
	db.add(
		RegistrationDataSourceVersion(
			id=uuid4(),
			source_id=source.id,
			version_number=ver,
			file_hash=digest,
			stored_file_id=stored.id,
			uploaded_by=customer_id,
			is_active=True,
		)
	)
	source.stored_file_id = stored.id
	source.file_name = filename[:255]
	source.file_hash = digest
	source.updated_at = datetime.utcnow()
	# Re-detect columns if sheet already selected
	if source.sheet_name:
		try:
			view = load_workbook_view(raw, filename, sheet_name=source.sheet_name)
			_sync_columns(db, source, view)
		except Exception as exc:
			raise HTTPException(status_code=400, detail=f"Could not refresh worksheet: {exc}")
	invalidate_source_cache(source)
	db.commit()
	return {"ok": True, "version": ver, "file_hash": digest, "configuration": _source_payload(db, source)}


@admin_router.delete("/{source_id}")
def deactivate_source(
	source_id: str,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	source = _require_owned_source(db, source_id, current_user)
	source.status = "inactive"
	source.updated_at = datetime.utcnow()
	invalidate_source_cache(source)
	db.commit()
	return {"ok": True, "status": "inactive"}


def _bytes(db: Session, source: RegistrationDataSource):
	from Services.dropdown_service import _load_file_bytes

	try:
		return _load_file_bytes(db, source)
	except DropdownServiceError as exc:
		raise HTTPException(status_code=exc.status_code, detail=exc.message)


# ── Public registration dropdown APIs ───────────────────────


def _resolve_event_for_form(db: Session, form_id: str) -> Optional[str]:
	"""Return event_id string for a form definition id or host form UUID."""
	# Integer form_definitions.id
	try:
		fid = int(form_id)
		form = db.query(FormDefinition).filter(FormDefinition.id == fid).first()
		if form and form.event_id:
			return str(form.event_id)
	except (TypeError, ValueError):
		pass
	# Host form UUID
	try:
		hf = db.query(EventRegistrationForm).filter(EventRegistrationForm.form_id == form_id).first()
		if hf:
			return str(hf.event_id)
	except Exception:
		pass
	# Treat form_id as event_id
	ev = db.query(EventManagement).filter(EventManagement.event_id == form_id).first()
	if ev:
		return str(ev.event_id)
	return None


@public_router.get("/{form_id}/data-fields")
def public_data_fields(
	form_id: str,
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional),
):
	event_id = _resolve_event_for_form(db, form_id)
	if not event_id:
		return {"fields": [], "source_id": None, "source_version_hash": None}
	source = active_source_for_event(db, event_id)
	if not source:
		return {"fields": [], "source_id": None, "source_version_hash": None}
	maps = mappings_for_source(db, source.id)
	rels = relationships_for_source(db, source.id)
	from Services.relationship_engine import ancestor_chain, build_parent_map

	parent_map = build_parent_map(rels)
	parent_of = {str(r.child_mapping_id): str(r.parent_mapping_id) for r in rels}
	mid_to_qid = {str(m.id): m.question_id for m in maps}
	fields = []
	for m in maps:
		mid = str(m.id)
		ancestors = [a for a in ancestor_chain(mid, parent_map) if a in mid_to_qid]
		immediate = parent_of.get(mid) if parent_of.get(mid) in mid_to_qid else None
		# If immediate parent mapping was deleted, walk to nearest mapped ancestor
		if not immediate and ancestors:
			immediate = ancestors[-1]
		fields.append(
			{
				"question_id": m.question_id,
				"mapping_id": mid,
				"parent_mapping_id": immediate,
				"parent_question_id": mid_to_qid.get(immediate) if immediate else None,
				"parent_question_ids": [mid_to_qid[a] for a in ancestors],
				"is_root": not bool(immediate),
				"sort_order": m.sort_order,
				"is_searchable": m.is_searchable,
				"placeholder": m.placeholder,
			}
		)
	return {
		"fields": fields,
		"source_id": str(source.id),
		"source_version_hash": source.file_hash,
		"event_id": event_id,
	}


@public_router.get("/{form_id}/dropdown/{field_id}/options")
async def public_dropdown_options(
	form_id: str,
	field_id: str,
	request: Request,
	search: Optional[str] = None,
	offset: int = Query(0, ge=0),
	limit: int = Query(500, ge=1, le=2000),
	parents: Optional[str] = Query(
		None,
		description="Parent selections as qid1:val1|qid2:val2",
	),
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional),
):
	"""Fetch dependent dropdown options. Pass parents via `parents` or `parent_<question_id>`."""
	event_id = _resolve_event_for_form(db, form_id)
	if not event_id:
		raise HTTPException(status_code=404, detail="Form not found.")
	source = active_source_for_event(db, event_id)
	if not source:
		return {"options": [], "total": 0, "disabled": True, "missing_parents": []}

	parent_answers: Dict[str, str] = {}
	if parents:
		for part in parents.split("|"):
			if ":" in part:
				k, v = part.split(":", 1)
				parent_answers[k.strip()] = v
	for key, val in request.query_params.multi_items():
		if key.startswith("parent_") and val is not None:
			parent_answers[key[7:]] = val
		elif key.startswith("p.") and val is not None:
			parent_answers[key[2:]] = val

	try:
		return options_for_question(
			db,
			source=source,
			question_id=field_id,
			parent_answers=parent_answers,
			search=search,
			offset=offset,
			limit=limit,
		)
	except DropdownServiceError as exc:
		raise HTTPException(status_code=exc.status_code, detail=exc.message)
