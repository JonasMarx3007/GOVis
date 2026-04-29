export type RelationStyle = {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
};

export const RELATION_STYLES: readonly RelationStyle[] = [
  { key: "is_a", label: "Is a", color: "#000000" },
  { key: "part_of", label: "Part of", color: "#0000FF" },
  { key: "regulates", label: "Regulates", color: "#FFC000" },
  { key: "positively_regulates", label: "Positively regulates", color: "#00FF00" },
  { key: "negatively_regulates", label: "Negatively regulates", color: "#FF0000" },
  { key: "occurs_in", label: "Occurs in", color: "#008080" },
] as const;

export const DEFAULT_RELATIONS = ["is_a"];

export const NAMESPACE_STYLES = {
  biological_process: {
    label: "Process",
    body: "#FFFFFF",
    header: "#00709B",
  },
  molecular_function: {
    label: "Function",
    body: "#FFFFFF",
    header: "#404040",
  },
  cellular_component: {
    label: "Component",
    body: "#FFFFFF",
    header: "#93A661",
  },
} as const;

export function relationClass(relation: string): string {
  return `relation-${relation.replace(/[^a-z_]/gi, "-")}`;
}

export function namespaceClass(namespace: string): string {
  return `namespace-${namespace.replace(/[^a-z_]/gi, "-")}`;
}
