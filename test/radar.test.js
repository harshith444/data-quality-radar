import test from "node:test";
import assert from "node:assert/strict";
import { loadCsv } from "../src/csv.js";
import { buildQualityReport } from "../src/radar.js";

const current = loadCsv(new URL("../data/orders_current.csv", import.meta.url));
const baseline = loadCsv(new URL("../data/orders_baseline.csv", import.meta.url));

test("builds a quality report with checks", () => {
  const report = buildQualityReport(current, baseline);
  assert.equal(report.checks.length, 5);
  assert.ok(report.score < 100);
});

test("detects missing revenue values", () => {
  const report = buildQualityReport(current, baseline);
  const completeness = report.checks.find((check) => check.name === "Completeness");
  assert.equal(completeness.level, "warning");
  assert.equal(completeness.details[0].field, "revenue");
});
