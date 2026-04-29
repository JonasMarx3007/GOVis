import { Download, Search, ZoomIn, ZoomOut, RotateCcw, Network, GitBranch, Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { CSSProperties } from "react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { fetchFocusedGraph, fetchOrganisms, fetchStats, fetchTermGenes, searchGenes, searchTerms } from "./api";
import { layoutGraph, layoutReadableGraph, type LayoutGraph, type LayoutMode, wrapName } from "./layout";
import { DEFAULT_RELATIONS, NAMESPACE_STYLES, namespaceClass, RELATION_STYLES, relationClass } from "./theme";
import type { GeneRecord, GOEdge, GOTerm, GraphResponse, Organism, StatsResponse } from "./types";

const DEFAULT_TERM = "GO:0019319";
const READABLE_LAYOUT_NODE_LIMIT = 260;
const READABLE_LAYOUT_EDGE_LIMIT = 420;
const READABLE_LAYOUT_COMPLEXITY_LIMIT = 80000;
const READABLE_LAYOUT_TIMEOUT_MS = 9000;

export function App() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [inputMode, setInputMode] = useState<"go" | "gene">("go");
  const [query, setQuery] = useState(DEFAULT_TERM);
  const [selectedTerms, setSelectedTerms] = useState<string[]>([DEFAULT_TERM]);
  const [detailId, setDetailId] = useState(DEFAULT_TERM);
  const [organism, setOrganism] = useState("goa_human");
  const [namespace, setNamespace] = useState("");
  const [ancestors, setAncestors] = useState(1);
  const [descendants, setDescendants] = useState(0);
  const [randomChildLimit, setRandomChildLimit] = useState(false);
  const [childLimit, setChildLimit] = useState(20);
  const [includeObsolete, setIncludeObsolete] = useState(false);
  const [selectedRelations, setSelectedRelations] = useState<string[]>(DEFAULT_RELATIONS);
  const [showLegend, setShowLegend] = useState(true);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("classic");
  const [trimConnections, setTrimConnections] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [scale, setScale] = useState(0.82);
  const [loading, setLoading] = useState(true);
  const [layouting, setLayouting] = useState(false);
  const [error, setError] = useState("");
  const [layoutNotice, setLayoutNotice] = useState("");
  const [termSuggestions, setTermSuggestions] = useState<GOTerm[]>([]);
  const [geneSuggestions, setGeneSuggestions] = useState<GeneRecord[]>([]);
  const [detailGenes, setDetailGenes] = useState<GeneRecord[]>([]);
  const [detailGeneCount, setDetailGeneCount] = useState(0);
  const [showDescendantGenes, setShowDescendantGenes] = useState(false);
  const searchTimer = useRef<number | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    fetchStats().then(setStats).catch((err: Error) => setError(err.message));
    fetchOrganisms()
      .then((payload) => {
        setOrganisms(payload);
        if (payload.length > 0 && !payload.some((entry) => entry.key === organism)) {
          setOrganism(payload[0].key);
        }
      })
      .catch((err: Error) => setError(err.message));
    loadFocused(DEFAULT_TERM);
  }, []);

  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    setTermSuggestions([]);
    setGeneSuggestions([]);
    if (query.trim().length < 2) {
      return;
    }
    const token = activeSearchToken(query);
    if (token.length < 2) {
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      if (inputMode === "go") {
        searchTerms(token, namespace, includeObsolete).then(setTermSuggestions).catch(() => setTermSuggestions([]));
      } else {
        searchGenes(token, organism).then(setGeneSuggestions).catch(() => setGeneSuggestions([]));
      }
    }, 180);
  }, [query, namespace, inputMode, organism, includeObsolete]);

  useEffect(() => {
    if (!detailId || !organism) {
      setDetailGenes([]);
      setDetailGeneCount(0);
      return;
    }
    fetchTermGenes(detailId, organism, showDescendantGenes)
      .then((payload) => {
        setDetailGenes(payload.genes);
        setDetailGeneCount(payload.geneCount);
      })
      .catch(() => {
        setDetailGenes([]);
        setDetailGeneCount(0);
      });
  }, [detailId, organism, showDescendantGenes]);

  const connectionGraph = useMemo(
    () => (graph ? buildConnectionGraph(graph, selectedTerms, trimConnections) : null),
    [graph, selectedTerms, trimConnections],
  );
  const [laidOut, setLaidOut] = useState<LayoutGraph | null>(null);
  const selectedTerm = graph?.nodes.find((node) => node.id === detailId);
  const maxAncestorDepth = stats?.maxAncestorDepth ?? graph?.maxAncestorDepth ?? 1;
  const maxDescendantDepth = stats?.maxDescendantDepth ?? graph?.maxDescendantDepth ?? 1;
  const svgExtraWidth = showLegend ? 410 : 0;

  useEffect(() => {
    setAncestors((value) => Math.min(value, maxAncestorDepth));
    setDescendants((value) => Math.min(value, maxDescendantDepth));
  }, [maxAncestorDepth, maxDescendantDepth]);

  useEffect(() => {
    let cancelled = false;
    if (!connectionGraph) {
      setLaidOut(null);
      setLayouting(false);
      setLayoutNotice("");
      return;
    }
    if (layoutMode === "classic") {
      setLayouting(false);
      setLayoutNotice("");
      startTransition(() => {
        if (!cancelled) {
          setLaidOut(layoutGraph(connectionGraph.nodes, connectionGraph.edges));
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const readableFallbackReason = readableLayoutFallbackReason(connectionGraph);
    if (readableFallbackReason) {
      setLayouting(false);
      setLayoutNotice(readableFallbackReason);
      startTransition(() => {
        if (!cancelled) {
          setLaidOut(layoutGraph(connectionGraph.nodes, connectionGraph.edges));
        }
      });
      return () => {
        cancelled = true;
      };
    }

    setLayouting(true);
    setLayoutNotice("");
    setLaidOut(null);
    withTimeout(
      layoutReadableGraph(connectionGraph.nodes, connectionGraph.edges),
      READABLE_LAYOUT_TIMEOUT_MS,
      "Readable layout took too long, so GOVis switched to classic for this graph.",
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setLaidOut(result);
        });
      })
      .catch((err: Error) => {
        if (cancelled) {
          return;
        }
        setLayoutNotice(err.message);
        startTransition(() => {
          setLaidOut(layoutGraph(connectionGraph.nodes, connectionGraph.edges));
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLayouting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connectionGraph, layoutMode]);

  function loadFocused(input = query) {
    const values = inputMode === "go" ? parseTerms(input) : parseGenes(input);
    if (values.length === 0) {
      setError(inputMode === "go" ? "Enter at least one GO ID" : "Enter at least one gene symbol or ID");
      return;
    }
    setLoading(true);
    setError("");
    setLayoutNotice("");
    fetchFocusedGraph(
      inputMode,
      values,
      organism,
      ancestors,
      descendants,
      namespace,
      randomChildLimit,
      childLimit,
      includeObsolete,
      selectedRelations,
    )
      .then((payload) => {
        setGraph(payload);
        setSelectedTerms(payload.selectedTerms.length > 0 ? payload.selectedTerms : values);
        setDetailId(payload.selectedTerms[0] ?? values[0]);
        setQuery(inputMode === "gene" && payload.selectedGenes ? payload.selectedGenes.map((gene) => gene.symbol).join("\n") : values.join("\n"));
        if (payload.missingTerms && payload.missingTerms.length > 0) {
          setError(`Ignored missing GO terms: ${payload.missingTerms.join(", ")}`);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function toggleRelation(relation: string) {
    setSelectedRelations((current) => {
      if (current.includes(relation)) {
        const next = current.filter((entry) => entry !== relation);
        return next.length > 0 ? next : DEFAULT_RELATIONS;
      }
      return [...current, relation];
    });
  }

  function chooseTerm(term: GOTerm) {
    setTermSuggestions([]);
    const terms = parseTerms(query);
    if (terms.includes(term.id)) {
      loadFocused(terms.join("\n"));
      return;
    }
    const next = [...terms, term.id];
    setQuery(next.join("\n"));
    loadFocused(next.join("\n"));
  }

  function chooseGene(gene: GeneRecord) {
    setGeneSuggestions([]);
    const genes = parseGenes(query);
    if (genes.some((entry) => entry.toUpperCase() === gene.symbol.toUpperCase())) {
      loadFocused(genes.join("\n"));
      return;
    }
    const next = [...genes, gene.symbol];
    setQuery(next.join("\n"));
    loadFocused(next.join("\n"));
  }

  return (
    <div className={`app-shell ${sidebarExpanded ? "" : "sidebar-collapsed"}`.trim()}>
      <aside className={`sidebar ${sidebarExpanded ? "" : "collapsed"}`.trim()}>
        <div className="sidebar-top">
          <div className="brand">
            <Network size={27} />
            {sidebarExpanded && (
              <div>
                <h1>GOVis</h1>
                <p>{stats?.dataVersion ?? "Gene Ontology"}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarExpanded((value) => !value)}
            title={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {sidebarExpanded && (
          <>
        <div className="field">
          <span>Search by</span>
          <div className="mode-toggle">
            <button className={inputMode === "go" ? "active" : ""} onClick={() => setInputMode("go")}>
              GO terms
            </button>
            <button className={inputMode === "gene" ? "active" : ""} onClick={() => setInputMode("gene")}>
              Genes
            </button>
          </div>
        </div>

        <label className="field">
          <span>{inputMode === "go" ? "GO terms" : "Genes"}</span>
          <div className="search-box">
            <Search size={18} />
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  loadFocused(query);
                }
              }}
              placeholder={inputMode === "go" ? "GO:0019319\nGO:0046364" : "TP53\nBRCA1"}
              rows={4}
            />
          </div>
        </label>

        {inputMode === "go" && termSuggestions.length > 0 && (
          <div className="suggestions">
            {termSuggestions.map((term) => (
              <button key={term.id} onClick={() => chooseTerm(term)}>
                <strong>{term.id}</strong>
                <span>{term.name}</span>
              </button>
            ))}
          </div>
        )}

        {inputMode === "gene" && geneSuggestions.length > 0 && (
          <div className="suggestions">
            {geneSuggestions.map((gene) => (
              <button key={gene.key} onClick={() => chooseGene(gene)}>
                <strong>{gene.symbol}</strong>
                <span>{gene.name || gene.key}</span>
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span>Organism</span>
          <select value={organism} onChange={(event) => setOrganism(event.target.value)}>
            {organisms.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Namespace</span>
          <select value={namespace} onChange={(event) => setNamespace(event.target.value)}>
            <option value="">All namespaces</option>
            {stats?.namespaces.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Layout</span>
          <div className="mode-toggle">
            <button className={layoutMode === "classic" ? "active" : ""} onClick={() => setLayoutMode("classic")}>
              Classic
            </button>
            <button className={layoutMode === "readable" ? "active" : ""} onClick={() => setLayoutMode("readable")}>
              Readable
            </button>
          </div>
        </div>

        <div className="slider-row">
          <label>
            <span>Ancestor depth</span>
            <input
              type="range"
              min="0"
              max={maxAncestorDepth}
              value={ancestors}
              onChange={(event) => setAncestors(Number(event.target.value))}
            />
          </label>
          <output>{ancestors}</output>
        </div>

        <div className="slider-row">
          <label>
            <span>Child depth</span>
            <input
              type="range"
              min="0"
              max={maxDescendantDepth}
              value={descendants}
              onChange={(event) => setDescendants(Number(event.target.value))}
            />
          </label>
          <output>{descendants}</output>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={randomChildLimit}
            onChange={(event) => setRandomChildLimit(event.target.checked)}
          />
          <span>Random child limit</span>
        </label>

        {randomChildLimit && (
          <div className="slider-row">
            <label>
              <span>Children per term</span>
              <input
                type="range"
                min="1"
                max="100"
                value={childLimit}
                onChange={(event) => setChildLimit(Number(event.target.value))}
              />
            </label>
            <output>{childLimit}</output>
          </div>
        )}

        <label className="check-row">
          <input
            type="checkbox"
            checked={includeObsolete}
            onChange={(event) => setIncludeObsolete(event.target.checked)}
          />
          <span>Include obsolete terms</span>
        </label>

        <div className="field">
          <span>Relations</span>
          <div className="relation-picks">
            {RELATION_STYLES.map((relation) => (
              <label key={relation.key} className="relation-option">
                <input
                  type="checkbox"
                  checked={selectedRelations.includes(relation.key)}
                  onChange={() => toggleRelation(relation.key)}
                />
                <span className={`relation-line ${relation.dashed ? "dashed" : ""}`} style={legendColorStyle(relation.color)} />
                <span>{relation.label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={trimConnections}
            onChange={(event) => setTrimConnections(event.target.checked)}
          />
          <span>Trim to selected paths</span>
        </label>

        <div className="actions">
          <button onClick={() => loadFocused(query)}>
            <GitBranch size={17} />
            {inputMode === "go" ? "Map terms" : "Map genes"}
          </button>
        </div>

        <div className="zoom-actions">
          <button title="Zoom out" onClick={() => setScale((value) => Math.max(0.18, value - 0.08))}>
            <ZoomOut size={18} />
          </button>
          <button title="Reset zoom" onClick={() => setScale(0.82)}>
            <RotateCcw size={18} />
          </button>
          <button title="Zoom in" onClick={() => setScale((value) => Math.min(1.7, value + 0.08))}>
            <ZoomIn size={18} />
          </button>
        </div>

        <div className="export-actions">
          <button title="Export PNG" onClick={() => exportFigure(svgRef.current, "png")}>
            <Download size={15} />
            PNG
          </button>
          <button title="Export SVG" onClick={() => exportFigure(svgRef.current, "svg")}>
            <Download size={15} />
            SVG
          </button>
          <button title="Export PDF" onClick={() => exportFigure(svgRef.current, "pdf")}>
            <Download size={15} />
            PDF
          </button>
        </div>

        {stats && (
          <dl className="stats">
            <div>
              <dt>Terms</dt>
              <dd>{stats.terms.toLocaleString()}</dd>
            </div>
            <div>
              <dt>is_a edges</dt>
              <dd>{stats.edges.toLocaleString()}</dd>
            </div>
          </dl>
        )}

        <label className="check-row">
          <input type="checkbox" checked={showLegend} onChange={(event) => setShowLegend(event.target.checked)} />
          <span>Show legend</span>
        </label>

        {selectedTerm && (
          <section className="term-detail">
            <h2>{selectedTerm.id}</h2>
            <h3>{selectedTerm.name}</h3>
            <dl className="term-counts">
              <div>
                <dt>Parents</dt>
                <dd>{selectedTerm.parentCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Children</dt>
                <dd>{selectedTerm.childCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{showDescendantGenes ? "Genes+" : "Genes"}</dt>
                <dd>{detailGeneCount.toLocaleString()}</dd>
              </div>
            </dl>
            <label className="check-row term-check">
              <input
                type="checkbox"
                checked={showDescendantGenes}
                onChange={(event) => setShowDescendantGenes(event.target.checked)}
              />
              <span>Show descendant genes</span>
            </label>
            <p>{selectedTerm.definition}</p>
            {detailGenes.length > 0 && (
              <div className="gene-list">
                <h4>{showDescendantGenes ? "Genes from term and descendants" : "Direct genes"}</h4>
                <ul>
                  {detailGenes.map((gene) => (
                    <li key={gene.key}>
                      <strong>{gene.symbol}</strong>
                      <span>{gene.name || gene.objectId}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="reference-links">
          <h2>References</h2>
          <p>
            GOVis is based on the Gene Ontology browsers{" "}
            <a href="https://amigo.geneontology.org/amigo" target="_blank" rel="noreferrer">
              AmiGO 2
            </a>{" "}
            and{" "}
            <a href="https://www.ebi.ac.uk/QuickGO/" target="_blank" rel="noreferrer">
              QuickGO
            </a>
            .
          </p>
        </section>
          </>
        )}
      </aside>

      <main className="graph-pane">
        {!sidebarExpanded && (
          <button
            type="button"
            className="sidebar-float-toggle"
            onClick={() => setSidebarExpanded(true)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={18} />
          </button>
        )}
        <div className={`graph-toolbar ${sidebarExpanded ? "" : "with-floating-toggle"}`.trim()}>
          <span>{graph ? `${graph.nodes.length.toLocaleString()} nodes / ${graph.edges.length.toLocaleString()} edges` : "Loading GO"}</span>
          {trimConnections && connectionGraph && <strong>{connectionGraph.nodes.length.toLocaleString()} visible after trim</strong>}
          {graph?.truncated && <strong>Limited graph</strong>}
          {selectedTerms.length > 1 && <strong>{selectedTerms.length} selected terms</strong>}
          {graph?.selectedGenes && graph.selectedGenes.length > 0 && <strong>{graph.selectedGenes.length} selected genes</strong>}
          {graph?.missingTerms && graph.missingTerms.length > 0 && <strong>{graph.missingTerms.length} ignored GO terms</strong>}
          {layoutNotice && <strong className="notice">{layoutNotice}</strong>}
          {error && <strong className="error">{error}</strong>}
        </div>

        <div className="canvas">
          {(loading || layouting) && (
            <div className="loading">
              <Loader2 size={28} />
              <span>{loading ? "Loading graph" : "Arranging layout"}</span>
            </div>
          )}
          {laidOut && !loading && !layouting && (
            <svg
              ref={svgRef}
              className="go-graph"
              width={(laidOut.width + svgExtraWidth) * scale}
              height={laidOut.height * scale}
              viewBox={`0 0 ${laidOut.width + svgExtraWidth} ${laidOut.height}`}
              role="img"
              aria-label="Gene Ontology relation graph"
            >
              <g className="edges">
                {laidOut.edges.map((edge) => (
                  <g
                    key={edgeKey(edge.source, edge.target, edge.relation)}
                    className={`${relationClass(edge.relation)} ${connectionGraph?.edgeClasses.get(edgeKey(edge.source, edge.target, edge.relation)) ?? ""}`.trim()}
                  >
                    <path d={edge.path} />
                    <path d={edge.markerPath} className="arrow-head" />
                  </g>
                ))}
              </g>
              <g className="nodes">
                {laidOut.nodes.map((node) => (
                  <g
                    key={node.id}
                    className={`go-node ${namespaceClass(node.namespace)} ${selectedTerms.includes(node.id) ? "selected" : ""} ${node.obsolete ? "obsolete" : ""}`}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => {
                      setDetailId(node.id);
                    }}
                    onDoubleClick={() => loadFocused(node.id)}
                  >
                    <rect className="body" width={node.width} height={node.height} />
                    <rect className="header" width={node.width} height={30} />
                    <text className="id" x={node.width / 2} y={21}>
                      {node.id}
                    </text>
                    {wrapName(node.name).map((line, index, lines) => (
                      <text
                        key={line}
                        className="name"
                        x={node.width / 2}
                        y={48 + index * 23 + Math.max(0, 3 - lines.length) * 7}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                ))}
              </g>
              {showLegend && <PlotLegend x={laidOut.width + 18} y={18} selectedRelations={selectedRelations} />}
            </svg>
          )}
        </div>
      </main>
    </div>
  );
}

function parseTerms(value: string): string[] {
  const entries: string[] = [];
  for (const line of value.replace(/;/g, "\n").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes(",")) {
      entries.push(...trimmed.split(",").map((entry) => entry.trim()).filter(Boolean));
    } else {
      entries.push(trimmed);
    }
  }
  return Array.from(new Set(entries));
}

function activeSearchToken(value: string): string {
  const parts = value.replace(/[;,]/g, " ").split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function parseGenes(value: string): string[] {
  return Array.from(
    new Set(
      value
        .replace(/[;,]/g, " ")
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function legendColorStyle(color: string): CSSProperties {
  return { ["--legend-color" as string]: color } as CSSProperties;
}

function PlotLegend({ x, y, selectedRelations }: { x: number; y: number; selectedRelations: string[] }) {
  const relationEntries = RELATION_STYLES.filter((relation) => selectedRelations.includes(relation.key));
  const namespaceEntries = [
    NAMESPACE_STYLES.biological_process,
    NAMESPACE_STYLES.molecular_function,
    NAMESPACE_STYLES.cellular_component,
  ];

  return (
    <g className="plot-legend" transform={`translate(${x}, ${y})`}>
      {namespaceEntries.map((entry, index) => (
        <g key={entry.label} transform={`translate(0, ${index * 34})`}>
          <rect width="138" height="22" fill={entry.header} />
          <text x="69" y="15" textAnchor="middle" className="legend-namespace-label">
            {entry.label}
          </text>
        </g>
      ))}

      {relationEntries.map((relation, index) => {
        const top = 138 + index * 50;
        return (
          <g key={relation.key} transform={`translate(0, ${top})`}>
            <text x="82" y="-10" textAnchor="middle" className="legend-relation-label">
              {relation.label}
            </text>
            <rect x="0" y="-8" width="24" height="24" fill="#FFFFFF" stroke="#000000" strokeWidth="1" />
            <text x="12" y="8" textAnchor="middle" className="legend-box-label">
              A
            </text>
            <line
              x1="32"
              y1="4"
              x2="132"
              y2="4"
              stroke={relation.color}
              strokeWidth="2.8"
              strokeDasharray={relation.dashed ? "6 4" : undefined}
            />
            <path d="M 132 4 L 124 0 L 124 8 Z" fill={relation.color} />
            <rect x="146" y="-8" width="24" height="24" fill="#FFFFFF" stroke="#000000" strokeWidth="1" />
            <text x="158" y="8" textAnchor="middle" className="legend-box-label">
              B
            </text>
          </g>
        );
      })}
    </g>
  );
}

type ConnectionGraph = {
  nodes: GOTerm[];
  edges: GOEdge[];
  edgeClasses: Map<string, string>;
};

function buildConnectionGraph(graph: GraphResponse, selectedTerms: string[], trim: boolean): ConnectionGraph {
  const selectedSet = new Set(selectedTerms);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const directSelectedEdges = new Set<string>();

  for (const edge of visibleEdges) {
    if (selectedSet.has(edge.source) && selectedSet.has(edge.target)) {
      directSelectedEdges.add(edgeKey(edge.source, edge.target, edge.relation));
    }
  }

  const connectorEdges = selectedSet.size > 1 ? collectShortestPathEdges(graph.nodes, visibleEdges, selectedSet) : new Set<string>();
  const edgeClasses = new Map<string, string>();

  for (const edge of visibleEdges) {
    const key = edgeKey(edge.source, edge.target, edge.relation);
    if (directSelectedEdges.has(key)) {
      edgeClasses.set(key, "selected-edge");
    } else if (connectorEdges.has(key)) {
      edgeClasses.set(key, "indirect-edge");
    }
  }

  if (!trim) {
    return {
      nodes: graph.nodes,
      edges: visibleEdges,
      edgeClasses,
    };
  }

  const keptNodeIds = new Set<string>();
  for (const id of selectedSet) {
    if (nodeIds.has(id)) {
      keptNodeIds.add(id);
    }
  }
  for (const edge of visibleEdges) {
    if (connectorEdges.has(edgeKey(edge.source, edge.target, edge.relation))) {
      keptNodeIds.add(edge.source);
      keptNodeIds.add(edge.target);
    }
  }

  const trimmedEdges = visibleEdges.filter((edge) => connectorEdges.has(edgeKey(edge.source, edge.target, edge.relation)));
  const trimmedEdgeClasses = new Map<string, string>();
  for (const edge of trimmedEdges) {
    const key = edgeKey(edge.source, edge.target, edge.relation);
    const edgeClass = edgeClasses.get(key);
    if (edgeClass) {
      trimmedEdgeClasses.set(key, edgeClass);
    }
  }

  return {
    nodes: graph.nodes.filter((node) => keptNodeIds.has(node.id)),
    edges: trimmedEdges,
    edgeClasses: trimmedEdgeClasses,
  };
}

function collectShortestPathEdges(nodes: GOTerm[], edges: GOEdge[], selectedSet: Set<string>): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const selectedIds = [...selectedSet].filter((id) => nodeIds.has(id)).sort();
  const connectorEdges = new Set<string>();

  for (let startIndex = 0; startIndex < selectedIds.length; startIndex += 1) {
    const startId = selectedIds[startIndex];
    const distFromStart = shortestDistances(startId, adjacency);

    for (let targetIndex = startIndex + 1; targetIndex < selectedIds.length; targetIndex += 1) {
      const targetId = selectedIds[targetIndex];
      const shortestDistance = distFromStart.get(targetId);
      if (shortestDistance === undefined || shortestDistance < 1) {
        continue;
      }

      const distFromTarget = shortestDistances(targetId, adjacency);
      for (const edge of edges) {
        const forward = edgeOnShortestPath(edge.source, edge.target, distFromStart, distFromTarget, shortestDistance);
        const backward = edgeOnShortestPath(edge.target, edge.source, distFromStart, distFromTarget, shortestDistance);
        if (forward || backward) {
          connectorEdges.add(edgeKey(edge.source, edge.target, edge.relation));
        }
      }
    }
  }

  return connectorEdges;
}

function shortestDistances(startId: string, adjacency: Map<string, string[]>): Map<string, number> {
  const distances = new Map<string, number>([[startId, 0]]);
  const queue = [startId];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const currentDistance = distances.get(current) ?? 0;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (distances.has(neighbor)) {
        continue;
      }
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }

  return distances;
}

function edgeOnShortestPath(
  from: string,
  to: string,
  distFromStart: Map<string, number>,
  distFromTarget: Map<string, number>,
  shortestDistance: number,
): boolean {
  const startDistance = distFromStart.get(from);
  const nextDistance = distFromStart.get(to);
  const targetDistance = distFromTarget.get(to);
  if (startDistance === undefined || nextDistance === undefined || targetDistance === undefined) {
    return false;
  }
  return nextDistance === startDistance + 1 && startDistance + 1 + targetDistance === shortestDistance;
}

function edgeKey(source: string, target: string, relation: string): string {
  return `${source}->${target}:${relation}`;
}

function readableLayoutFallbackReason(graph: ConnectionGraph): string {
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const complexity = nodeCount * edgeCount;
  if (
    nodeCount <= READABLE_LAYOUT_NODE_LIMIT &&
    edgeCount <= READABLE_LAYOUT_EDGE_LIMIT &&
    complexity <= READABLE_LAYOUT_COMPLEXITY_LIMIT
  ) {
    return "";
  }
  return `Readable layout skipped for ${nodeCount.toLocaleString()} nodes and ${edgeCount.toLocaleString()} edges; GOVis switched to classic to avoid freezing. Try Trim to selected paths or lower ancestor/child depth.`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function exportFigure(svg: SVGSVGElement | null, format: "png" | "svg" | "pdf") {
  if (!svg) {
    return;
  }
  const fileBase = `govis-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (format === "svg") {
    downloadBlob(new Blob([serializeFigureSvg(svg)], { type: "image/svg+xml;charset=utf-8" }), `${fileBase}.svg`);
    return;
  }

  const canvas = await renderSvgToCanvas(svg, format === "pdf" ? 2 : 3);
  if (format === "png") {
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `${fileBase}.png`);
      }
    }, "image/png");
    return;
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
  const pdf = buildImagePdf(dataUrl, canvas.width, canvas.height);
  const pdfBuffer = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(pdfBuffer).set(pdf);
  downloadBlob(new Blob([pdfBuffer], { type: "application/pdf" }), `${fileBase}.pdf`);
}

function serializeFigureSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = svgDimensions(svg);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    .go-graph { background: #ffffff; }
    .edges path { fill: none; stroke: #4f5b66; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .edges .arrow-head { fill: #4f5b66; stroke: none; }
    .edges .indirect-edge path { stroke-width: 4.5; }
    .edges .selected-edge path { stroke-width: 6.4; }
    ${relationExportStyles()}
    .go-node .body { fill: #ffffff; stroke: #101010; stroke-width: 2.2; }
    .go-node.selected .body { fill: #ffffcc; stroke: #cfb437; stroke-width: 3.2; }
    .go-node.obsolete .body { stroke: #c42828; stroke-width: 2.8; }
    .go-node.obsolete.selected .body { stroke: #c42828; stroke-width: 3.2; }
    .go-node .header { fill: #7c8792; }
    ${namespaceExportStyles()}
    .go-node .id { fill: #ffffff; font-size: 18px; font-weight: 600; text-anchor: middle; dominant-baseline: middle; }
    .go-node .name { fill: #1c242a; font-size: 18px; font-weight: 500; text-anchor: middle; dominant-baseline: middle; }
  `;
  clone.insertBefore(style, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

function relationExportStyles(): string {
  return RELATION_STYLES.map(
    (relation) =>
      `.edges .${relationClass(relation.key)} path { stroke: ${relation.color}; }\n` +
      `.edges .${relationClass(relation.key)} .arrow-head { fill: ${relation.color}; }\n` +
      (relation.dashed ? `.edges .${relationClass(relation.key)} path { stroke-dasharray: 6 4; }` : ""),
  ).join("\n");
}

function namespaceExportStyles(): string {
  return Object.entries(NAMESPACE_STYLES)
    .map(
      ([namespace, style]) =>
        `.go-node.${namespaceClass(namespace)} .body { fill: ${style.body}; }\n` +
        `.go-node.${namespaceClass(namespace)} .header { fill: ${style.header}; }`,
    )
    .join("\n");
}

function svgDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    return { width: Math.ceil(viewBox.width), height: Math.ceil(viewBox.height) };
  }
  return {
    width: Math.ceil(svg.getBoundingClientRect().width || 1200),
    height: Math.ceil(svg.getBoundingClientRect().height || 800),
  };
}

function renderSvgToCanvas(svg: SVGSVGElement, scale: number): Promise<HTMLCanvasElement> {
  const markup = serializeFigureSvg(svg);
  const { width, height } = svgDimensions(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not create export canvas"));
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not render SVG export"));
    };
    image.src = url;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function buildImagePdf(dataUrl: string, imageWidth: number, imageHeight: number): Uint8Array {
  const imageBytes = dataUrlToBytes(dataUrl);
  const pageWidth = Math.min(1440, Math.max(240, imageWidth));
  const pageHeight = Math.max(240, Math.round((pageWidth / imageWidth) * imageHeight));
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;

  const append = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | Uint8Array, extraBeforeBinary = "") => {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
    if (body instanceof Uint8Array) {
      append(extraBeforeBinary);
      append(body);
      append("\nendstream\nendobj\n");
    } else {
      append(`${body}\nendobj\n`);
    }
  };

  append("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(
    4,
    imageBytes,
    `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
  );
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);

  const xrefOffset = length;
  append(`xref\n0 6\n0000000000 65535 f \n`);
  for (let id = 1; id <= 5; id += 1) {
    append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
