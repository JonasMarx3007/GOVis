import type { GeneRecord, GOTerm, GraphResponse, Organism, StatsResponse } from "./types";

const BASE_PATH = normalizeBasePath(import.meta.env.VITE_BASE_PATH ?? import.meta.env.BASE_URL ?? "/");
const API_BASE = import.meta.env.VITE_API_BASE ?? BASE_PATH;

export async function fetchStats(): Promise<StatsResponse> {
  return getJson<StatsResponse>("/api/stats");
}

export async function searchTerms(query: string, namespace: string, includeObsolete: boolean): Promise<GOTerm[]> {
  const params = new URLSearchParams({ q: query, limit: "30" });
  if (namespace) {
    params.set("namespace", namespace);
  }
  if (includeObsolete) {
    params.set("includeObsolete", "true");
  }
  const payload = await getJson<{ terms: GOTerm[] }>(`/api/terms?${params}`);
  return payload.terms;
}

export async function fetchOrganisms(): Promise<Organism[]> {
  const payload = await getJson<{ organisms: Organism[] }>("/api/organisms");
  return payload.organisms;
}

export async function searchGenes(query: string, organism: string): Promise<GeneRecord[]> {
  const params = new URLSearchParams({ q: query, organism, limit: "30" });
  const payload = await getJson<{ genes: GeneRecord[] }>(`/api/genes?${params}`);
  return payload.genes;
}

export async function fetchTermGenes(
  termId: string,
  organism: string,
  includeDescendants: boolean,
): Promise<{ geneCount: number; genes: GeneRecord[]; includeDescendants: boolean }> {
  const params = new URLSearchParams({ organism, limit: "500" });
  if (includeDescendants) {
    params.set("descendants", "true");
  }
  return getJson<{ geneCount: number; genes: GeneRecord[]; includeDescendants: boolean }>(
    `/api/terms/${encodeURIComponent(termId)}/genes?${params}`,
  );
}

export async function fetchFocusedGraph(
  mode: "go" | "gene",
  values: string[],
  organism: string,
  ancestors: number,
  descendants: number,
  namespace: string,
  randomChildLimit: boolean,
  childLimit: number,
  includeObsolete: boolean,
  relations: string[],
): Promise<GraphResponse> {
  const params = new URLSearchParams({
    ancestors: String(ancestors),
    descendants: String(descendants),
    limit: "2500",
  });
  if (mode === "gene") {
    params.set("genes", values.join(","));
    params.set("organism", organism);
  } else {
    params.set("terms", values.join(","));
    if (organism) {
      params.set("organism", organism);
    }
  }
  if (randomChildLimit) {
    params.set("randomChildLimit", "true");
    params.set("childLimit", String(childLimit));
  }
  if (namespace) {
    params.set("namespace", namespace);
  }
  if (includeObsolete) {
    params.set("includeObsolete", "true");
  }
  if (relations.length > 0) {
    params.set("relations", relations.join(","));
  }
  return getJson<GraphResponse>(`/api/graph?${params}`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

function normalizeBasePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
