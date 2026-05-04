export function buildQualityReport(current, baseline, now = new Date("2026-04-28T12:00:00Z")) {
  const checks = [
    completenessCheck(current),
    duplicateCheck(current.rows, "order_id"),
    schemaDriftCheck(current.headers, baseline.headers),
    freshnessCheck(current.rows, "event_date", now),
    anomalyCheck(current.rows, "revenue")
  ];

  const score = Math.max(0, Math.round(100 - checks.reduce((total, check) => total + check.penalty, 0)));

  return {
    score,
    status: score >= 90 ? "healthy" : score >= 75 ? "watch" : "attention",
    rowCount: current.rows.length,
    checks,
    recommendations: recommendations(checks),
    generatedAt: new Date().toISOString()
  };
}

function completenessCheck(dataset) {
  const missing = dataset.rows.flatMap((row, rowIndex) =>
    dataset.headers
      .filter((header) => row[header] === "")
      .map((field) => ({ row: rowIndex + 1, field }))
  );

  return {
    name: "Completeness",
    level: missing.length ? "warning" : "pass",
    value: `${missing.length} missing values`,
    penalty: missing.length * 4,
    details: missing
  };
}

function duplicateCheck(rows, key) {
  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row[key])) duplicates.push(row[key]);
    seen.add(row[key]);
  }

  return {
    name: "Uniqueness",
    level: duplicates.length ? "warning" : "pass",
    value: `${duplicates.length} duplicate ${key} values`,
    penalty: duplicates.length * 5,
    details: duplicates
  };
}

function schemaDriftCheck(currentHeaders, baselineHeaders) {
  const missing = baselineHeaders.filter((header) => !currentHeaders.includes(header));
  const added = currentHeaders.filter((header) => !baselineHeaders.includes(header));
  const drift = missing.length + added.length;

  return {
    name: "Schema Drift",
    level: drift ? "critical" : "pass",
    value: drift ? `${drift} schema changes` : "No schema drift",
    penalty: drift * 12,
    details: { missing, added }
  };
}

function freshnessCheck(rows, field, now) {
  const latest = rows
    .map((row) => new Date(`${row[field]}T00:00:00Z`))
    .sort((a, b) => b - a)[0];
  const ageHours = Math.round((now - latest) / 36e5);

  return {
    name: "Freshness",
    level: ageHours > 48 ? "warning" : "pass",
    value: `${ageHours} hours since latest event`,
    penalty: ageHours > 48 ? 8 : 0,
    details: { latest: latest.toISOString().slice(0, 10), ageHours }
  };
}

function anomalyCheck(rows, field) {
  const values = rows.map((row) => Number(row[field])).filter((value) => Number.isFinite(value));
  const mean = average(values);
  const sd = standardDeviation(values, mean);
  const anomalies = rows.filter((row) => Math.abs((Number(row[field]) - mean) / sd) > 2);

  return {
    name: "Revenue Anomalies",
    level: anomalies.length ? "warning" : "pass",
    value: `${anomalies.length} outlier rows`,
    penalty: anomalies.length * 7,
    details: anomalies.map((row) => ({ order_id: row.order_id, revenue: row.revenue }))
  };
}

function recommendations(checks) {
  return checks
    .filter((check) => check.level !== "pass")
    .map((check) => {
      if (check.name === "Completeness") return "Backfill missing values or route incomplete records into a quarantine table.";
      if (check.name === "Uniqueness") return "Add a uniqueness constraint or deduplication step on the business key.";
      if (check.name === "Schema Drift") return "Review upstream schema changes before downstream models consume this dataset.";
      if (check.name === "Freshness") return "Check scheduler health and upstream delivery latency.";
      return "Inspect outlier records and confirm whether they are real business spikes or data errors.";
    });
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values, mean) {
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) || 1;
}
