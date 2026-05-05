const NULL_LIKE = new Set(["", "null", "none", "n/a", "na", "nan", "undefined"]);

export function profileData(dataset, useCase = "") {
  const headers = dataset.headers || Object.keys(dataset.rows[0] || {});
  const normalizedHeaders = headers.map(normalizeHeader);
  const rows = dataset.rows || [];
  const columns = headers.map((header, index) => profileColumn(header, normalizedHeaders[index], rows));
  const duplicateRows = duplicateRowIndexes(rows);
  const lowInformationColumns = columns.filter((column) => column.uniqueCount <= 1 || column.missingRate >= 0.98).map((column) => column.name);
  const correlations = numericCorrelations(columns, rows);
  const useCaseTerms = tokenize(useCase);

  return {
    useCase,
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    normalizedHeaders,
    columns: columns.map((column) => ({
      ...column,
      relevance: relevanceScore(column, useCaseTerms)
    })),
    duplicateRows,
    lowInformationColumns,
    correlations,
    qualityIssues: qualityIssues(headers, normalizedHeaders, columns, duplicateRows, correlations)
  };
}

export async function buildCleaningPlan(dataset, options = {}) {
  const useCase = options.useCase || "";
  const mode = options.mode || "balanced";
  const profile = profileData(dataset, useCase);
  const heuristicPlan = localCleaningPlan(profile, { mode, useCase });

  if (options.provider?.name === "openai" && options.provider?.enabled) {
    const llmPlan = await options.provider.createCleaningPlan({ profile, useCase, mode, localPlan: heuristicPlan });
    return validateCleaningPlan(llmPlan, profile, heuristicPlan);
  }

  return heuristicPlan;
}

export function previewCleaning(dataset, plan) {
  const before = profileData(dataset, plan.useCaseSummary || "");
  const cleaned = applyCleaning(dataset, plan, { dryRun: false });
  const after = profileData(cleaned.dataset, plan.useCaseSummary || "");

  return {
    beforeScore: qualityScore(before),
    afterScore: qualityScore(after),
    changedRows: cleaned.audit.filter((entry) => entry.rowsAffected > 0).reduce((total, entry) => total + entry.rowsAffected, 0),
    audit: cleaned.audit,
    beforeIssues: before.qualityIssues,
    afterIssues: after.qualityIssues,
    sampleRows: cleaned.dataset.rows.slice(0, 5)
  };
}

export function applyCleaning(dataset, plan) {
  let working = cloneDataset(dataset);
  const audit = [];
  const approvedActions = [...(plan.safeAutoFixes || []), ...(plan.recommendedActions || []).filter((action) => action.approved)];

  for (const action of approvedActions) {
    const result = applyAction(working, action);
    working = result.dataset;
    audit.push({
      id: action.id,
      type: action.type,
      column: action.column,
      status: result.status,
      rowsAffected: result.rowsAffected,
      message: result.message
    });
  }

  return {
    dataset: working,
    audit,
    report: {
      useCase: plan.useCaseSummary,
      appliedActions: audit,
      rejectedRiskyFixes: plan.riskyFixes || [],
      analysisSuggestions: plan.analysisSuggestions || []
    }
  };
}

export function analysisSuggestions(profile, useCase = "") {
  const numeric = profile.columns.filter((column) => column.type === "numeric" && column.relevance > 0).slice(0, 3);
  const categorical = profile.columns.filter((column) => column.type === "categorical" && column.relevance > 0).slice(0, 3);
  const suggestions = [];

  if (numeric.length && categorical.length) {
    suggestions.push(`Compare ${numeric[0].normalizedName} by ${categorical[0].normalizedName}.`);
  }
  if (profile.correlations.length) {
    const top = profile.correlations[0];
    suggestions.push(`Inspect correlation between ${top.left} and ${top.right} (${top.correlation.toFixed(2)}).`);
  }
  if (profile.columns.some((column) => column.missingCount > 0)) {
    suggestions.push("Run missingness analysis before modeling or dashboarding.");
  }
  if (useCase) {
    suggestions.push(`Create a focused dataset for: ${useCase}.`);
  }

  return suggestions;
}

export function validateCleaningPlan(plan, profile, fallbackPlan = null) {
  if (!plan || typeof plan !== "object") return fallbackPlan || localCleaningPlan(profile, { mode: "balanced", useCase: profile.useCase });
  const allowed = new Set(["rename_header", "trim_whitespace", "standardize_case", "standardize_categories", "convert_type", "impute_null", "drop_column", "remove_duplicates", "flag_outliers"]);
  const columns = new Set(profile.headers);
  const normalize = (actions = []) =>
    actions
      .filter((action) => allowed.has(action.type))
      .filter((action) => !action.column || columns.has(action.column) || profile.normalizedHeaders.includes(action.column))
      .map((action, index) => ({
        id: action.id || `${action.type}_${index + 1}`,
        confidence: action.confidence ?? 0.75,
        risk: action.risk || "medium",
        reason: action.reason || "Suggested by cleaning planner.",
        ...action
      }));

  return {
    useCaseSummary: String(plan.useCaseSummary || profile.useCase || "General data cleaning"),
    qualityIssues: Array.isArray(plan.qualityIssues) ? plan.qualityIssues : profile.qualityIssues,
    recommendedActions: normalize(plan.recommendedActions),
    requiresApproval: normalize(plan.requiresApproval),
    safeAutoFixes: normalize(plan.safeAutoFixes),
    riskyFixes: normalize(plan.riskyFixes),
    analysisSuggestions: Array.isArray(plan.analysisSuggestions) ? plan.analysisSuggestions : analysisSuggestions(profile, profile.useCase),
    generatedCode: Array.isArray(plan.generatedCode) ? plan.generatedCode : []
  };
}

function localCleaningPlan(profile, { mode, useCase }) {
  const safeAutoFixes = [];
  const recommendedActions = [];
  const riskyFixes = [];
  let id = 1;

  for (const column of profile.columns) {
    if (column.name !== column.normalizedName) {
      safeAutoFixes.push(action(id++, "rename_header", column.name, { newName: column.normalizedName, risk: "low", reason: "Normalize headers for consistent code and SQL usage." }));
    }
    if (column.leadingOrTrailingSpaces > 0) {
      safeAutoFixes.push(action(id++, "trim_whitespace", column.name, { risk: "low", reason: "Remove leading/trailing spaces from string values." }));
    }
    if (column.type === "categorical" && column.caseVariants.length) {
      recommendedActions.push(action(id++, "standardize_case", column.name, { style: "lower", risk: "medium", reason: "Standardize casing for categorical consistency." }));
    }
    const lowInformation = profile.lowInformationColumns.includes(column.name);
    if (column.missingCount > 0 && !lowInformation) {
      const strategy = column.type === "numeric" ? "median" : "mode";
      recommendedActions.push(action(id++, "impute_null", column.name, { strategy, risk: "medium", reason: `Fill missing values using ${strategy} for ${column.type} data.` }));
    }
    if (column.type === "numeric" && column.outliers.length) {
      recommendedActions.push(action(id++, "flag_outliers", column.name, { risk: "medium", reason: "Flag extreme values instead of silently deleting them." }));
    }
    if (column.type === "unknown") {
      riskyFixes.push(action(id++, "convert_type", column.name, { targetType: "string", risk: "high", reason: "Type is unclear; conversion needs review." }));
    }
    if (lowInformation && mode !== "conservative") {
      recommendedActions.push(action(id++, "drop_column", column.name, { risk: "medium", reason: "Column has little usable information for the selected use case." }));
    }
  }

  if (profile.duplicateRows.length) {
    recommendedActions.push(action(id++, "remove_duplicates", null, { risk: "medium", reason: "Duplicate rows can inflate analysis results." }));
  }

  return {
    useCaseSummary: useCase || "General data quality and cleaning",
    qualityIssues: profile.qualityIssues,
    recommendedActions,
    requiresApproval: recommendedActions,
    safeAutoFixes,
    riskyFixes,
    analysisSuggestions: analysisSuggestions(profile, useCase),
    generatedCode: generatedCodeForPlan([...safeAutoFixes, ...recommendedActions])
  };
}

function action(id, type, column, extra) {
  return {
    id: `clean_${id}`,
    type,
    column,
    confidence: extra.risk === "low" ? 0.95 : 0.78,
    ...extra
  };
}

function applyAction(dataset, action) {
  if (action.type === "rename_header") return renameHeader(dataset, action.column, action.newName);
  if (action.type === "trim_whitespace") return transformColumn(dataset, action.column, (value) => (typeof value === "string" ? value.trim() : value), "Trimmed whitespace.");
  if (action.type === "standardize_case") return transformColumn(dataset, action.column, (value) => (typeof value === "string" ? value.trim().toLowerCase() : value), "Standardized text casing.");
  if (action.type === "impute_null") return imputeNull(dataset, action.column, action.strategy);
  if (action.type === "drop_column") return dropColumn(dataset, action.column);
  if (action.type === "remove_duplicates") return removeDuplicates(dataset);
  if (action.type === "flag_outliers") return flagOutliers(dataset, action.column);
  return { dataset, status: "skipped", rowsAffected: 0, message: `Unsupported action ${action.type}.` };
}

function profileColumn(name, normalizedName, rows) {
  const rawValues = rows.map((row) => row[name]);
  const present = rawValues.filter((value) => !isNullLike(value));
  const numericValues = present.map(Number).filter(Number.isFinite);
  const stringValues = present.filter((value) => typeof value === "string");
  const unique = [...new Set(present.map((value) => String(value).trim()))];
  const type = inferType(present, numericValues);
  const outliers = type === "numeric" ? numericOutliers(numericValues) : [];
  const lowerGroups = groupBy(stringValues.map((value) => value.trim()), (value) => value.toLowerCase());

  return {
    name,
    normalizedName,
    type,
    missingCount: rows.length - present.length,
    missingRate: rows.length ? (rows.length - present.length) / rows.length : 0,
    uniqueCount: unique.length,
    examples: unique.slice(0, 6),
    leadingOrTrailingSpaces: stringValues.filter((value) => value !== value.trim()).length,
    caseVariants: Object.values(lowerGroups).filter((values) => new Set(values).size > 1),
    outliers,
    stats: type === "numeric" ? numericStats(numericValues) : null
  };
}

function qualityIssues(headers, normalizedHeaders, columns, duplicateRows, correlations) {
  const issues = [];
  headers.forEach((header, index) => {
    if (header !== normalizedHeaders[index]) issues.push({ type: "messy_header", column: header, severity: "low", message: `Rename ${header} to ${normalizedHeaders[index]}.` });
  });
  columns.forEach((column) => {
    if (column.missingCount) issues.push({ type: "missing_values", column: column.name, severity: "medium", message: `${column.missingCount} missing values.` });
    if (column.leadingOrTrailingSpaces) issues.push({ type: "whitespace", column: column.name, severity: "low", message: `${column.leadingOrTrailingSpaces} values have leading/trailing spaces.` });
    if (column.caseVariants.length) issues.push({ type: "categorical_inconsistency", column: column.name, severity: "medium", message: "Mixed casing or category variants detected." });
    if (column.outliers.length) issues.push({ type: "outliers", column: column.name, severity: "medium", message: `${column.outliers.length} possible outliers.` });
  });
  if (duplicateRows.length) issues.push({ type: "duplicates", severity: "medium", message: `${duplicateRows.length} duplicate rows detected.` });
  correlations.slice(0, 3).forEach((correlation) => {
    issues.push({ type: "correlation", severity: "info", message: `${correlation.left} and ${correlation.right} correlate at ${correlation.correlation.toFixed(2)}.` });
  });
  return issues;
}

function normalizeHeader(header) {
  return String(header)
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function inferType(values, numericValues) {
  if (!values.length) return "unknown";
  if (numericValues.length / values.length >= 0.85) return "numeric";
  return "categorical";
}

function isNullLike(value) {
  return value == null || NULL_LIKE.has(String(value).trim().toLowerCase());
}

function numericStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], max: sorted.at(-1), mean: average(values), median: quantile(sorted, 0.5) };
}

function numericOutliers(values) {
  if (values.length < 4) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  return values.filter((value) => value < low || value > high);
}

function numericCorrelations(columns, rows) {
  const numeric = columns.filter((column) => column.type === "numeric");
  const result = [];
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const left = numeric[i].name;
      const right = numeric[j].name;
      const pairs = rows.map((row) => [Number(row[left]), Number(row[right])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
      if (pairs.length >= 3) {
        const corr = correlation(pairs.map(([a]) => a), pairs.map(([, b]) => b));
        if (Math.abs(corr) >= 0.7) result.push({ left, right, correlation: corr });
      }
    }
  }
  return result.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

function relevanceScore(column, terms) {
  if (!terms.length) return 0;
  const haystack = tokenize(`${column.name} ${column.normalizedName} ${column.examples.join(" ")}`);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function duplicateRowIndexes(rows) {
  const seen = new Map();
  const duplicates = [];
  rows.forEach((row, index) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicates.push(index);
    else seen.set(key, index);
  });
  return duplicates;
}

function renameHeader(dataset, from, to) {
  if (!dataset.headers.includes(from)) return { dataset, status: "skipped", rowsAffected: 0, message: `Column ${from} not found.` };
  const headers = dataset.headers.map((header) => (header === from ? to : header));
  const rows = dataset.rows.map((row) => {
    const next = { ...row, [to]: row[from] };
    delete next[from];
    return next;
  });
  return { dataset: { headers, rows }, status: "applied", rowsAffected: rows.length, message: `Renamed ${from} to ${to}.` };
}

function transformColumn(dataset, column, transform, message) {
  column = resolveColumn(dataset, column);
  let rowsAffected = 0;
  const rows = dataset.rows.map((row) => {
    const oldValue = row[column];
    const newValue = transform(oldValue);
    if (oldValue !== newValue) rowsAffected++;
    return { ...row, [column]: newValue };
  });
  return { dataset: { ...dataset, rows }, status: "applied", rowsAffected, message };
}

function imputeNull(dataset, column, strategy = "mode") {
  column = resolveColumn(dataset, column);
  const values = dataset.rows.map((row) => row[column]).filter((value) => !isNullLike(value));
  const replacement = strategy === "median" ? median(values.map(Number).filter(Number.isFinite)) : mode(values);
  return transformColumn(dataset, column, (value) => (isNullLike(value) ? replacement : value), `Imputed missing values with ${strategy}.`);
}

function dropColumn(dataset, column) {
  column = resolveColumn(dataset, column);
  const headers = dataset.headers.filter((header) => header !== column);
  const rows = dataset.rows.map((row) => {
    const next = { ...row };
    delete next[column];
    return next;
  });
  return { dataset: { headers, rows }, status: "applied", rowsAffected: rows.length, message: `Dropped ${column}.` };
}

function removeDuplicates(dataset) {
  const seen = new Set();
  const rows = [];
  let rowsAffected = 0;
  for (const row of dataset.rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) rowsAffected++;
    else {
      seen.add(key);
      rows.push(row);
    }
  }
  return { dataset: { ...dataset, rows }, status: "applied", rowsAffected, message: "Removed duplicate rows." };
}

function flagOutliers(dataset, column) {
  column = resolveColumn(dataset, column);
  const values = dataset.rows.map((row) => Number(row[column])).filter(Number.isFinite);
  const outliers = new Set(numericOutliers(values));
  const flag = `${normalizeHeader(column)}_is_outlier`;
  const headers = dataset.headers.includes(flag) ? dataset.headers : [...dataset.headers, flag];
  let rowsAffected = 0;
  const rows = dataset.rows.map((row) => {
    const isOutlier = outliers.has(Number(row[column]));
    if (isOutlier) rowsAffected++;
    return { ...row, [flag]: isOutlier };
  });
  return { dataset: { headers, rows }, status: "applied", rowsAffected, message: `Flagged outliers in ${column}.` };
}

function resolveColumn(dataset, column) {
  if (!column) return column;
  if (dataset.headers.includes(column)) return column;
  const normalized = normalizeHeader(column);
  return dataset.headers.find((header) => normalizeHeader(header) === normalized) || column;
}

function generatedCodeForPlan(actions) {
  const renamed = new Map();
  const resolve = (column) => renamed.get(column) || column;
  return actions.map((action) => {
    const column = resolve(action.column);
    if (action.type === "rename_header") {
      renamed.set(action.column, action.newName);
      return `df = df.rename(columns={"${action.column}": "${action.newName}"})`;
    }
    if (action.type === "trim_whitespace") return `df["${column}"] = df["${column}"].astype(str).str.strip()`;
    if (action.type === "standardize_case") return `df["${column}"] = df["${column}"].astype(str).str.strip().str.lower()`;
    if (action.type === "impute_null") return `df["${column}"] = df["${column}"].fillna(df["${column}"].${action.strategy === "median" ? "median()" : "mode()[0]"})`;
    if (action.type === "drop_column") return `df = df.drop(columns=["${column}"])`;
    if (action.type === "remove_duplicates") return "df = df.drop_duplicates()";
    if (action.type === "flag_outliers") return `# Flag outliers in ${column} using IQR`;
    return `# ${action.type} for ${column || "dataset"}`;
  });
}

function cloneDataset(dataset) {
  return {
    headers: [...dataset.headers],
    rows: dataset.rows.map((row) => ({ ...row }))
  };
}

function tokenize(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function groupBy(values, getKey) {
  return values.reduce((groups, value) => {
    const key = getKey(value);
    groups[key] ||= [];
    groups[key].push(value);
    return groups;
  }, {});
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] == null ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function mode(values) {
  const counts = values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function correlation(a, b) {
  const meanA = average(a);
  const meanB = average(b);
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0);
  const denomA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0));
  const denomB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denomA && denomB ? numerator / (denomA * denomB) : 0;
}

function qualityScore(profile) {
  const penalty = profile.qualityIssues.reduce((total, issue) => {
    if (issue.severity === "high") return total + 12;
    if (issue.severity === "medium") return total + 7;
    if (issue.severity === "low") return total + 3;
    return total + 1;
  }, 0);
  return Math.max(0, 100 - penalty);
}
