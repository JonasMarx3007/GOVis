from __future__ import annotations

import random
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GOTerm:
    id: str
    name: str
    namespace: str
    definition: str
    parents: tuple[str, ...]
    obsolete: bool = False


@dataclass(frozen=True)
class GOGraph:
    terms: dict[str, GOTerm]
    children: dict[str, tuple[str, ...]]
    levels: dict[str, int]
    data_version: str | None
    source: str

    @property
    def edge_count(self) -> int:
        return sum(len(term.parents) for term in self.terms.values() if not term.obsolete)

    @property
    def namespaces(self) -> tuple[str, ...]:
        return tuple(sorted({term.namespace for term in self.terms.values() if not term.obsolete}))

    @property
    def max_ancestor_depth(self) -> int:
        return max(self.levels.values(), default=0)

    @property
    def max_descendant_depth(self) -> int:
        return self.max_ancestor_depth

    def resolve_inputs(self, values: list[str], include_obsolete: bool = False) -> tuple[list[str], list[str]]:
        requested = list(dict.fromkeys(value.strip() for value in values if value.strip()))
        visible_terms = {
            term_id: term for term_id, term in self.terms.items() if include_obsolete or not term.obsolete
        }
        name_index = {term.name.strip().lower(): term.id for term in visible_terms.values()}
        valid: list[str] = []
        missing: list[str] = []

        for value in requested:
            normalized_id = value.upper()
            if normalized_id in visible_terms:
                if normalized_id not in valid:
                    valid.append(normalized_id)
                continue

            by_name = name_index.get(value.lower())
            if by_name:
                if by_name not in valid:
                    valid.append(by_name)
                continue

            missing.append(value)
        return valid, missing

    def search(self, query: str = "", namespace: str = "", limit: int = 40, include_obsolete: bool = False) -> list[GOTerm]:
        q = query.strip().lower()
        matches: list[GOTerm] = []
        for term in self.terms.values():
            if not include_obsolete and term.obsolete:
                continue
            if namespace and term.namespace != namespace:
                continue
            if q and q not in term.id.lower() and q not in term.name.lower():
                continue
            matches.append(term)
            if len(matches) >= limit:
                break
        return matches

    def subgraph(
        self,
        term_id: str,
        ancestors: int = 6,
        descendants: int = 1,
        namespace: str = "",
        limit: int = 700,
        random_child_limit: int | None = None,
    ) -> tuple[list[GOTerm], list[tuple[str, str]]]:
        return self.subgraph_for_terms([term_id], ancestors, descendants, namespace, limit, random_child_limit)

    def normalize_terms(self, term_ids: list[str], include_obsolete: bool = False) -> tuple[list[str], list[str]]:
        return self.resolve_inputs(term_ids, include_obsolete)

    def subgraph_for_terms(
        self,
        term_ids: list[str],
        ancestors: int = 6,
        descendants: int = 0,
        namespace: str = "",
        limit: int = 700,
        random_child_limit: int | None = None,
        include_obsolete: bool = False,
    ) -> tuple[list[GOTerm], list[tuple[str, str]]]:
        requested, missing = self.normalize_terms(term_ids, include_obsolete)
        if not requested:
            if missing:
                raise ValueError("None of the entered GO terms exist in the current ontology")
            raise ValueError("At least one GO term is required")

        selected: set[str] = set(requested)
        protected: set[str] = set(requested)
        per_seed_limit = max(1, limit // max(1, len(requested)))
        for term_id in requested:
            parent_nodes = self._walk(term_id, "parents", ancestors, limit, include_obsolete=include_obsolete)
            protected.update(parent_nodes)
            selected.update(parent_nodes)
            selected.update(
                self._walk(
                    term_id,
                    "children",
                    descendants,
                    per_seed_limit,
                    random_child_limit,
                    include_obsolete=include_obsolete,
                )
            )

        if namespace:
            selected = {node_id for node_id in selected if self.terms[node_id].namespace == namespace}
        if not include_obsolete:
            selected = {node_id for node_id in selected if not self.terms[node_id].obsolete}
            protected = {node_id for node_id in protected if node_id in selected}

        if len(selected) > limit:
            protected = {node_id for node_id in protected if node_id in selected}
            remaining = sorted(selected - protected)
            selected = set(sorted(protected)[:limit])
            selected.update(remaining[: max(0, limit - len(selected))])

        nodes = [self.terms[node_id] for node_id in sorted(selected)]
        edges = [
            (term.id, parent_id)
            for term in nodes
            for parent_id in term.parents
            if parent_id in selected
        ]
        return nodes, edges

    def roots(self, namespace: str = "") -> list[GOTerm]:
        return [
            term
            for term in self.terms.values()
            if not term.obsolete and not term.parents and (not namespace or term.namespace == namespace)
        ]

    def descendants_of(self, term_id: str) -> set[str]:
        if term_id not in self.terms:
            raise KeyError(term_id)
        descendants: set[str] = set()
        queue: deque[str] = deque([term_id])
        while queue:
            current = queue.popleft()
            for child in self.children.get(current, ()):
                if child in descendants:
                    continue
                descendants.add(child)
                queue.append(child)
        return descendants

    def _walk(
        self,
        start_id: str,
        direction: str,
        max_depth: int,
        hard_limit: int,
        random_child_limit: int | None = None,
        include_obsolete: bool = False,
    ) -> set[str]:
        if max_depth <= 0:
            return set()

        seen: set[str] = set()
        queue: deque[tuple[str, int]] = deque([(start_id, 0)])
        while queue and len(seen) < hard_limit:
            node_id, depth = queue.popleft()
            if depth >= max_depth:
                continue
            if direction == "parents":
                neighbors = self.terms[node_id].parents
            else:
                neighbors = self._children_for_walk(node_id, random_child_limit)
            for neighbor in neighbors:
                if neighbor in seen or neighbor not in self.terms:
                    continue
                if not include_obsolete and self.terms[neighbor].obsolete:
                    continue
                seen.add(neighbor)
                queue.append((neighbor, depth + 1))
        return seen

    def _children_for_walk(self, node_id: str, random_child_limit: int | None) -> tuple[str, ...]:
        children = self.children.get(node_id, ())
        if random_child_limit is None or len(children) <= random_child_limit:
            return children
        return tuple(sorted(random.sample(children, random_child_limit)))


def parse_obo(path: Path) -> GOGraph:
    terms: dict[str, GOTerm] = {}
    children: dict[str, list[str]] = defaultdict(list)
    data_version: str | None = None

    current: dict[str, object] | None = None
    in_term = False

    def commit(term_data: dict[str, object] | None) -> None:
        if not term_data:
            return
        term_id = str(term_data.get("id", ""))
        if not term_id:
            return
        parents = tuple(dict.fromkeys(term_data.get("parents", ())))
        terms[term_id] = GOTerm(
            id=term_id,
            name=str(term_data.get("name", term_id)),
            namespace=str(term_data.get("namespace", "")),
            definition=str(term_data.get("definition", "")),
            parents=parents,
            obsolete=bool(term_data.get("obsolete", False)),
        )

    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("data-version:"):
                data_version = line.split(":", 1)[1].strip()
                continue
            if line == "[Term]":
                commit(current)
                current = {"parents": []}
                in_term = True
                continue
            if line.startswith("[") and line.endswith("]"):
                commit(current)
                current = None
                in_term = False
                continue
            if not in_term or current is None:
                continue
            if line.startswith("id:"):
                current["id"] = line.split(":", 1)[1].strip()
            elif line.startswith("name:"):
                current["name"] = line.split(":", 1)[1].strip()
            elif line.startswith("namespace:"):
                current["namespace"] = line.split(":", 1)[1].strip()
            elif line.startswith("def:"):
                current["definition"] = _clean_definition(line.split(":", 1)[1].strip())
            elif line.startswith("is_obsolete: true"):
                current["obsolete"] = True
            elif line.startswith("is_a:"):
                parent = line.split("!", 1)[0].split(":", 1)[1].strip()
                current.setdefault("parents", []).append(parent)
        commit(current)

    for term in terms.values():
        filtered_parents = tuple(parent for parent in term.parents if parent in terms)
        if filtered_parents != term.parents:
            terms[term.id] = GOTerm(
                id=term.id,
                name=term.name,
                namespace=term.namespace,
                definition=term.definition,
                parents=filtered_parents,
                obsolete=term.obsolete,
            )
        for parent_id in filtered_parents:
            children[parent_id].append(term.id)

    frozen_children = {key: tuple(sorted(value)) for key, value in children.items()}
    return GOGraph(
        terms=terms,
        children=frozen_children,
        levels=_compute_levels(terms),
        data_version=data_version,
        source=str(path),
    )


def _clean_definition(value: str) -> str:
    if value.startswith('"'):
        end = value.find('"', 1)
        if end > 0:
            return value[1:end]
    return value


def _compute_levels(terms: dict[str, GOTerm]) -> dict[str, int]:
    memo: dict[str, int] = {}

    def level(term_id: str, visiting: set[str]) -> int:
        cached = memo.get(term_id)
        if cached is not None:
            return cached
        if term_id in visiting:
            return 0
        visiting.add(term_id)
        parents = tuple(parent for parent in terms[term_id].parents if parent in terms)
        value = 0 if not parents else max(level(parent, visiting) for parent in parents) + 1
        visiting.remove(term_id)
        memo[term_id] = value
        return value

    for term_id in terms:
        level(term_id, set())
    return memo
