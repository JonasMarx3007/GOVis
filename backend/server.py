from __future__ import annotations

import argparse
import json
import sys
import threading
import webbrowser
from functools import lru_cache
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .annotations import AnnotationIndex, gene_json, list_organisms, load_annotations, organism_json
from .go_parser import GOGraph, GOTerm, parse_obo


def _app_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[1]


ROOT = _app_root()
DEFAULT_OBO = ROOT / "go-basic.obo"
FRONTEND_DIST = ROOT / "frontend" / "dist"
ANNOTATIONS_DIR = ROOT / "annotations"


@lru_cache(maxsize=1)
def load_graph(path: str = str(DEFAULT_OBO)) -> GOGraph:
    return parse_obo(Path(path))


class GOVisHandler(SimpleHTTPRequestHandler):
    graph_path = str(DEFAULT_OBO)

    def translate_path(self, path: str) -> str:
        static_root = FRONTEND_DIST if FRONTEND_DIST.exists() else ROOT
        route = urlparse(path).path
        if route == "/":
            index = static_root / "index.html"
            if index.exists():
                return str(index)
        return str(static_root / route.lstrip("/"))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed.path, parse_qs(parsed.query))
            return
        super().do_GET()

    def _handle_api(self, path: str, query: dict[str, list[str]]) -> None:
        graph = load_graph(self.graph_path)
        try:
            if path == "/api/health":
                self._json({"ok": True, "dataVersion": graph.data_version})
            elif path == "/api/stats":
                self._json(
                    {
                        "terms": len(graph.terms),
                        "edges": graph.edge_count,
                        "namespaces": graph.namespaces,
                        "maxAncestorDepth": graph.max_ancestor_depth,
                        "maxDescendantDepth": graph.max_descendant_depth,
                        "dataVersion": graph.data_version,
                        "source": graph.source,
                    }
                )
            elif path == "/api/organisms":
                self._json({"organisms": [organism_json(item) for item in list_organisms(ANNOTATIONS_DIR)]})
            elif path == "/api/genes":
                annotations = _annotations(_one(query, "organism"))
                q = _one(query, "q")
                limit = _int(query, "limit", 30, 1, 250)
                self._json(
                    {
                        "organism": organism_json(annotations.organism),
                        "dateGenerated": annotations.date_generated,
                        "genes": [gene_json(gene) for gene in annotations.search(q, limit)],
                    }
                )
            elif path == "/api/roots":
                namespace = _one(query, "namespace")
                self._json({"terms": [_term_json(graph, term) for term in graph.roots(namespace)]})
            elif path == "/api/terms":
                q = _one(query, "q")
                namespace = _one(query, "namespace")
                limit = _int(query, "limit", 40, 1, 250)
                include_obsolete = _bool(query, "includeObsolete")
                self._json(
                    {
                        "terms": [
                            _term_json(graph, term)
                            for term in graph.search(q, namespace, limit, include_obsolete=include_obsolete)
                        ]
                    }
                )
            elif path.startswith("/api/terms/"):
                remainder = unquote(path.removeprefix("/api/terms/"))
                term_id = remainder.removesuffix("/genes")
                term = graph.terms.get(term_id)
                if not term:
                    self._json({"error": f"Unknown GO term: {term_id}"}, HTTPStatus.NOT_FOUND)
                    return
                if remainder.endswith("/genes"):
                    annotations = _annotations(_one(query, "organism"))
                    include_descendants = _bool(query, "descendants")
                    if include_descendants:
                        term_ids = [term_id, *sorted(graph.descendants_of(term_id))]
                        total, genes = annotations.genes_for_terms(term_ids, _int(query, "limit", 80, 1, 5000))
                    else:
                        total, genes = annotations.genes_for_term(term_id, _int(query, "limit", 80, 1, 5000))
                    self._json(
                        {
                            "term": _term_json(graph, term, annotations, include_genes=True, gene_limit=80),
                            "organism": organism_json(annotations.organism),
                            "geneCount": total,
                            "includeDescendants": include_descendants,
                            "genes": [gene_json(gene) for gene in genes],
                        }
                    )
                    return
                self._json(
                    {
                        "term": _term_json(graph, term),
                        "parents": [_term_json(graph, graph.terms[parent]) for parent in term.parents],
                        "children": [_term_json(graph, graph.terms[child]) for child in graph.children.get(term.id, ())],
                    }
                )
            elif path == "/api/graph":
                annotations = _optional_annotations(_one(query, "organism"))
                gene_resolution = None
                missing_terms: list[str] = []
                include_obsolete = _bool(query, "includeObsolete")
                if _one(query, "genes"):
                    if annotations is None:
                        raise ValueError("Select an organism before searching by gene")
                    gene_resolution = annotations.resolve_genes(_items(query, "genes"))
                    if not gene_resolution.terms:
                        missing = ", ".join(gene_resolution.missing) or _one(query, "genes")
                        raise ValueError(f"No GO terms found for gene input: {missing}")
                    term_ids, missing_terms = graph.normalize_terms(list(gene_resolution.terms), include_obsolete=include_obsolete)
                else:
                    term_ids, missing_terms = graph.normalize_terms(_terms(query), include_obsolete=include_obsolete)
                random_child_limit = None
                if _bool(query, "randomChildLimit"):
                    random_child_limit = _int(query, "childLimit", 20, 1, 500)
                nodes, edges = graph.subgraph_for_terms(
                    term_ids=term_ids,
                    ancestors=_int(query, "ancestors", 1, 0, graph.max_ancestor_depth),
                    descendants=_int(query, "descendants", 0, 0, graph.max_descendant_depth),
                    namespace=_one(query, "namespace"),
                    limit=_int(query, "limit", 700, 1, 5000),
                    random_child_limit=random_child_limit,
                    include_obsolete=include_obsolete,
                )
                self._json(_graph_json(graph, nodes, edges, term_ids, False, annotations, gene_resolution, missing_terms))
            else:
                self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except KeyError as exc:
            self._json({"error": f"Unknown GO term: {exc.args[0]}"}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def _json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _one(query: dict[str, list[str]], key: str, default: str = "") -> str:
    return query.get(key, [default])[0].strip()


def _items(query: dict[str, list[str]], key: str) -> list[str]:
    values = query.get(key, [])
    items: list[str] = []
    for raw in values:
        normalized = raw.replace(",", " ").replace(";", " ").replace("\n", " ")
        items.extend(part.strip() for part in normalized.split() if part.strip())
    return list(dict.fromkeys(items))


def _terms(query: dict[str, list[str]]) -> list[str]:
    raw_values = query.get("term", []) + query.get("terms", [])
    if not raw_values:
        raw_values = ["GO:0019319"]

    return _go_items(raw_values)


def _go_items(values: list[str]) -> list[str]:
    items: list[str] = []
    for raw in values:
        for line in raw.replace(";", "\n").splitlines():
            line = line.strip()
            if not line:
                continue
            if "," in line:
                items.extend(part.strip() for part in line.split(",") if part.strip())
            else:
                items.append(line)
    return list(dict.fromkeys(items))


def _int(query: dict[str, list[str]], key: str, default: int, minimum: int, maximum: int) -> int:
    raw = query.get(key, [str(default)])[0]
    value = int(raw)
    return max(minimum, min(maximum, value))


def _bool(query: dict[str, list[str]], key: str) -> bool:
    raw = query.get(key, ["false"])[0].strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _annotations(organism_key: str) -> AnnotationIndex:
    if not organism_key:
        organism_key = "goa_human"
    return load_annotations(str(ANNOTATIONS_DIR), organism_key)


def _optional_annotations(organism_key: str) -> AnnotationIndex | None:
    if not organism_key:
        return None
    return _annotations(organism_key)


def _term_json(
    graph: GOGraph,
    term: GOTerm,
    annotations: AnnotationIndex | None = None,
    include_genes: bool = False,
    gene_limit: int = 0,
) -> dict[str, object]:
    payload = {
        "id": term.id,
        "name": term.name,
        "namespace": term.namespace,
        "definition": term.definition,
        "parentCount": len(term.parents),
        "childCount": len(graph.children.get(term.id, ())),
        "level": graph.levels.get(term.id, 0),
        "obsolete": term.obsolete,
    }
    if annotations is not None:
        gene_count, genes = annotations.genes_for_term(term.id, gene_limit)
        payload["geneCount"] = gene_count
        if include_genes:
            payload["genes"] = [gene_json(gene) for gene in genes]
    return payload


def _graph_json(
    graph: GOGraph,
    nodes: list[GOTerm],
    edges: list[tuple[str, str]],
    selected_terms: list[str] | None = None,
    truncated: bool = False,
    annotations: AnnotationIndex | None = None,
    gene_resolution: object | None = None,
    missing_terms: list[str] | None = None,
) -> dict[str, object]:
    selected = selected_terms or []
    payload: dict[str, object] = {
        "selected": selected[0] if selected else "",
        "selectedTerms": selected,
        "missingTerms": missing_terms or [],
        "maxAncestorDepth": graph.max_ancestor_depth,
        "maxDescendantDepth": graph.max_descendant_depth,
        "truncated": truncated,
        "nodes": [_term_json(graph, term, annotations) for term in nodes],
        "edges": [{"source": source, "target": target} for source, target in edges],
    }
    if annotations is not None:
        payload["organism"] = organism_json(annotations.organism)
        payload["annotationDate"] = annotations.date_generated
    if gene_resolution is not None:
        payload["selectedGenes"] = [gene_json(gene) for gene in gene_resolution.genes]
        payload["missingGenes"] = list(gene_resolution.missing)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="GOVis REST API and static frontend server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--obo", default=str(DEFAULT_OBO))
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser window on startup")
    args = parser.parse_args()

    GOVisHandler.graph_path = str(Path(args.obo).resolve())
    load_graph(GOVisHandler.graph_path)

    server = ThreadingHTTPServer((args.host, args.port), GOVisHandler)
    browser_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    app_url = f"http://{browser_host}:{args.port}"
    print(f"GOVis API running at {app_url}")
    print(f"Loaded {GOVisHandler.graph_path}")
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(app_url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping GOVis...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
