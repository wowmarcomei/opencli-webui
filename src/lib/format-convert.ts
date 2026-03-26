import yaml from "js-yaml";

export type OutputFormat = "table" | "json" | "yaml" | "csv" | "md";

export function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function toYaml(data: unknown): string {
  return yaml.dump(data, { lineWidth: 120, quotingType: '"' });
}

export function toCsv(data: unknown[]): string {
  if (!data.length) return "";
  const cols = Object.keys(data[0] as object);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = [cols.join(","), ...data.map((row) => cols.map((c) => escape((row as Record<string, unknown>)[c])).join(","))];
  return rows.join("\n");
}

export function toMarkdown(data: unknown[]): string {
  if (!data.length) return "";
  const cols = Object.keys(data[0] as object);
  const cell = (v: unknown) => String(v == null ? "" : v).replace(/\|/g, "\\|");
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const rows = data.map((row) => `| ${cols.map((c) => cell((row as Record<string, unknown>)[c])).join(" | ")} |`);
  return [header, sep, ...rows].join("\n");
}

export function convertData(data: unknown, format: OutputFormat): string {
  if (format === "json") return toJson(data);
  if (format === "yaml") return toYaml(data);
  if (format === "csv") return Array.isArray(data) ? toCsv(data) : toJson(data);
  if (format === "md") return Array.isArray(data) ? toMarkdown(data) : toJson(data);
  return toJson(data);
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const FORMAT_META: Record<OutputFormat, { label: string; ext: string; mime: string }> = {
  table: { label: "表格", ext: "csv", mime: "text/csv" },
  json:  { label: "JSON", ext: "json", mime: "application/json" },
  yaml:  { label: "YAML", ext: "yaml", mime: "text/yaml" },
  csv:   { label: "CSV",  ext: "csv",  mime: "text/csv" },
  md:    { label: "MD",   ext: "md",   mime: "text/markdown" },
};
