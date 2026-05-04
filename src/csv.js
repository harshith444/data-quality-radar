import { readFileSync } from "node:fs";

export function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");

  return {
    headers,
    rows: lines.map((line) => {
      const values = line.split(",");
      return Object.fromEntries(headers.map((header, index) => [header, cast(values[index] ?? "")]));
    })
  };
}

export function loadCsv(path) {
  return parseCsv(readFileSync(path, "utf8"));
}

function cast(value) {
  if (value === "") return "";
  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
}
