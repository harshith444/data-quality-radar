import test from "node:test";
import assert from "node:assert/strict";
import { loadCsv } from "../src/csv.js";
import { applyCleaning, buildCleaningPlan, previewCleaning, profileData } from "../src/cleaningAgent.js";
import { connectorStatuses } from "../src/connectors.js";

const messy = loadCsv(new URL("../data/messy_customers.csv", import.meta.url));

test("profiles messy headers, nulls, whitespace, duplicates, and outliers", () => {
  const profile = profileData(messy, "predict churn");
  assert.ok(profile.qualityIssues.some((issue) => issue.type === "messy_header"));
  assert.ok(profile.qualityIssues.some((issue) => issue.type === "missing_values"));
  assert.ok(profile.qualityIssues.some((issue) => issue.type === "whitespace"));
  assert.ok(profile.qualityIssues.some((issue) => issue.type === "duplicates"));
  assert.ok(profile.qualityIssues.some((issue) => issue.type === "outliers"));
});

test("builds a use-case-aware cleaning plan", async () => {
  const plan = await buildCleaningPlan(messy, { useCase: "predict churn", mode: "balanced" });
  assert.ok(plan.safeAutoFixes.some((action) => action.type === "rename_header"));
  assert.ok(plan.recommendedActions.some((action) => action.type === "drop_column"));
  assert.ok(plan.analysisSuggestions.some((suggestion) => suggestion.includes("predict churn")));
  assert.ok(plan.generatedCode.length > 0);
});

test("previews and applies approved cleaning without mutating source", async () => {
  const plan = await buildCleaningPlan(messy, { useCase: "predict churn", mode: "balanced" });
  plan.recommendedActions.forEach((action) => {
    if (["standardize_case", "impute_null", "remove_duplicates", "flag_outliers"].includes(action.type)) action.approved = true;
  });

  const preview = previewCleaning(messy, plan);
  const result = applyCleaning(messy, plan);

  assert.ok(preview.afterScore >= preview.beforeScore);
  assert.ok(result.dataset.headers.includes("customer_id"));
  assert.ok(result.audit.length > 0);
  assert.equal(messy.headers.includes("Customer ID "), true);
});

test("reports local and cloud connector readiness", () => {
  const connectors = connectorStatuses();
  assert.ok(connectors.some((connector) => connector.id === "local" && connector.status === "ready"));
  assert.ok(connectors.some((connector) => connector.id === "s3"));
  assert.ok(connectors.some((connector) => connector.id === "azure_blob"));
  assert.ok(connectors.some((connector) => connector.id === "snowflake"));
});
