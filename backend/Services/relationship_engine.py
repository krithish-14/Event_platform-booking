"""Parent/child relationship helpers for Smart Data Mapping."""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple
from uuid import UUID


class RelationshipError(ValueError):
	pass


def would_create_cycle(
	edges: Sequence[Tuple[str, str]],
	new_parent: str,
	new_child: str,
) -> bool:
	"""edges are (parent_id, child_id). Return True if adding parent→child creates a cycle."""
	if new_parent == new_child:
		return True
	graph: Dict[str, Set[str]] = {}
	for p, c in edges:
		graph.setdefault(p, set()).add(c)
	graph.setdefault(new_parent, set()).add(new_child)

	# DFS from child — can we reach parent?
	stack = [new_child]
	seen: Set[str] = set()
	while stack:
		node = stack.pop()
		if node == new_parent:
			return True
		if node in seen:
			continue
		seen.add(node)
		stack.extend(graph.get(node, ()))
	return False


def build_parent_map(
	relationships: Iterable,
) -> Dict[str, List[str]]:
	"""child_mapping_id -> [parent_mapping_id, ...]"""
	out: Dict[str, List[str]] = {}
	for rel in relationships:
		if not getattr(rel, "is_active", True):
			continue
		child = str(rel.child_mapping_id)
		parent = str(rel.parent_mapping_id)
		out.setdefault(child, []).append(parent)
	return out


def ancestor_chain(
	child_mapping_id: str,
	parent_map: Dict[str, List[str]],
) -> List[str]:
	"""Return ordered ancestors root→…→immediate parent (no cycles assumed)."""
	ordered: List[str] = []
	visited: Set[str] = set()

	def walk(mid: str) -> None:
		for parent in parent_map.get(mid, []):
			if parent in visited:
				continue
			visited.add(parent)
			walk(parent)
			ordered.append(parent)

	walk(child_mapping_id)
	return ordered


def root_mapping_ids(mapping_ids: Sequence[str], parent_map: Dict[str, List[str]]) -> List[str]:
	children_with_parents = set(parent_map.keys())
	return [m for m in mapping_ids if m not in children_with_parents]


def as_uuid(value) -> Optional[UUID]:
	try:
		return UUID(str(value))
	except Exception:
		return None
