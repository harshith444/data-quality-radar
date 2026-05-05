from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import math
import re
from statistics import median
from typing import Any, Iterable


NULL_LIKE = {"", "null", "none", "n/a", "na", "nan", "undefined"}


@dataclass
class RadarResult:
    cleaned_data: Any
    profile: dict[str, Any]
    plan: dict[str, Any]
    preview: dict[str, Any]
    report: dict[str, Any]
    notebook_cells: list[str]

    def _repr_html_(self) -> str:
        rows = "".join(
            f"<tr><td>{action.get('type')}</td><td>{action.get('column') or '-'}</td><td>{action.get('reason','')}</td></tr>"
            for action in self.plan.get("safeAutoFixes", []) + self.plan.get("recommendedActions", [])
        )
        return f"""
        <h2>Data Quality Radar</h2>
        <p><strong>Before score:</strong> {self.preview.get('beforeScore')} &nbsp;
        <strong>After score:</strong> {self.preview.get('afterScore')}</p>
        <table><thead><tr><th>Action</th><th>Column</th><th>Reason</th></tr></thead><tbody>{rows}</tbody></table>
        """


def profile(data: Any, use_case: str = "") -> dict[str, Any]:
    records, headers, _kind = _to_records(data)
    columns = [_profile_column(header, records) for header in headers]
    duplicate_rows = _duplicate_indexes(records)
    correlations = _correlations(columns, records)
    terms = _tokens(use_case)
    for column in columns:
        column["relevance"] = _relevance(column, terms)
    low_information = [column["name"] for column in columns if column["uniqueCount"] <= 1 or column["missingRate"] >= 0.98]
    issues = _quality_issues(headers, columns, duplicate_rows, correlations)
    return {
        "useCase": use_case,
        "rowCount": len(records),
        "columnCount": len(headers),
        "headers": headers,
        "columns": columns,
        "duplicateRows": duplicate_rows,
        "lowInformationColumns": low_information,
        "correlations": correlations,
        "qualityIssues": issues,
    }


def plan(data: Any, use_case: str = "", mode: str = "balanced", provider: str = "openai") -> dict[str, Any]:
    data_profile = profile(data, use_case)
    actions: list[dict[str, Any]] = []
    recommended: list[dict[str, Any]] = []
    risky: list[dict[str, Any]] = []
    idx = 1

    for column in data_profile["columns"]:
        if column["name"] != column["normalizedName"]:
            actions.append(_action(idx, "rename_header", column["name"], newName=column["normalizedName"], risk="low", reason="Normalize header for repeatable code."))
            idx += 1
        if column["leadingOrTrailingSpaces"]:
            actions.append(_action(idx, "trim_whitespace", column["name"], risk="low", reason="Remove leading and trailing spaces."))
            idx += 1
        if column["caseVariants"]:
            recommended.append(_action(idx, "standardize_case", column["name"], style="lower", risk="medium", reason="Standardize category casing."))
            idx += 1
        low_information = column["name"] in data_profile["lowInformationColumns"]
        if column["missingCount"] and not low_information:
            strategy = "median" if column["type"] == "numeric" else "mode"
            recommended.append(_action(idx, "impute_null", column["name"], strategy=strategy, risk="medium", reason=f"Fill missing values with {strategy}."))
            idx += 1
        if column["outliers"]:
            recommended.append(_action(idx, "flag_outliers", column["name"], risk="medium", reason="Flag outliers for review instead of deleting them."))
            idx += 1
        if low_information and mode != "conservative":
            recommended.append(_action(idx, "drop_column", column["name"], risk="medium", reason="Column has little information for analysis."))
            idx += 1

    if data_profile["duplicateRows"]:
        recommended.append(_action(idx, "remove_duplicates", None, risk="medium", reason="Duplicate rows can distort analysis."))

    suggestions = _analysis_suggestions(data_profile, use_case)
    return {
        "useCaseSummary": use_case or "General data quality and cleaning",
        "qualityIssues": data_profile["qualityIssues"],
        "recommendedActions": recommended,
        "requiresApproval": recommended,
        "safeAutoFixes": actions,
        "riskyFixes": risky,
        "analysisSuggestions": suggestions,
        "generatedCode": to_notebook_cells({"safeAutoFixes": actions, "recommendedActions": recommended}),
        "provider": provider,
        "providerNote": "Provider adapter ready; deterministic fallback used unless an LLM integration is configured.",
    }


def preview(data: Any, cleaning_plan: dict[str, Any]) -> dict[str, Any]:
    before = profile(data, cleaning_plan.get("useCaseSummary", ""))
    cleaned = clean(data, cleaning_plan)
    after = profile(cleaned, cleaning_plan.get("useCaseSummary", ""))
    return {
        "beforeScore": _score(before),
        "afterScore": _score(after),
        "beforeIssues": before["qualityIssues"],
        "afterIssues": after["qualityIssues"],
        "sampleRows": _to_records(cleaned)[0][:5],
    }


def clean(data: Any, cleaning_plan: dict[str, Any]) -> Any:
    records, headers, kind = _to_records(data)
    dataset = {"headers": headers[:], "rows": deepcopy(records)}
    actions = cleaning_plan.get("safeAutoFixes", []) + [a for a in cleaning_plan.get("recommendedActions", []) if a.get("approved")]
    for action in actions:
        dataset = _apply(dataset, action)
    return _from_records(dataset["rows"], dataset["headers"], kind)


def run(data: Any, use_case: str, mode: str = "balanced", apply: bool = False) -> RadarResult:
    data_profile = profile(data, use_case)
    cleaning_plan = plan(data, use_case, mode)
    effective_plan = deepcopy(cleaning_plan)
    if apply:
        for action in effective_plan.get("recommendedActions", []):
            action["approved"] = True
    cleaned = clean(data, effective_plan) if apply else data
    preview_report = preview(data, effective_plan)
    return RadarResult(
        cleaned_data=cleaned,
        profile=data_profile,
        plan=cleaning_plan,
        preview=preview_report,
        report={"useCase": use_case, "applied": apply, "analysisSuggestions": cleaning_plan["analysisSuggestions"]},
        notebook_cells=to_notebook_cells(cleaning_plan),
    )


def to_notebook_cells(cleaning_plan: dict[str, Any]) -> list[str]:
    actions = cleaning_plan.get("safeAutoFixes", []) + cleaning_plan.get("recommendedActions", [])
    cells = []
    renamed = {}
    for action in actions:
        column = renamed.get(action.get("column"), action.get("column"))
        if action["type"] == "rename_header":
            cells.append(f'df = df.rename(columns={{"{column}": "{action["newName"]}"}})')
            renamed[action.get("column")] = action["newName"]
        elif action["type"] == "trim_whitespace":
            cells.append(f'df["{column}"] = df["{column}"].astype(str).str.strip()')
        elif action["type"] == "standardize_case":
            cells.append(f'df["{column}"] = df["{column}"].astype(str).str.strip().str.lower()')
        elif action["type"] == "impute_null":
            fill = f'df["{column}"].median()' if action.get("strategy") == "median" else f'df["{column}"].mode()[0]'
            cells.append(f'df["{column}"] = df["{column}"].fillna({fill})')
        elif action["type"] == "drop_column":
            cells.append(f'df = df.drop(columns=["{column}"])')
        elif action["type"] == "remove_duplicates":
            cells.append("df = df.drop_duplicates()")
        elif action["type"] == "flag_outliers":
            cells.append(f'# Flag outliers in {column} using the IQR rule')
    return cells


def _to_records(data: Any) -> tuple[list[dict[str, Any]], list[str], str]:
    if hasattr(data, "to_dict") and hasattr(data, "columns"):
        records = data.to_dict(orient="records")
        return records, list(data.columns), "pandas"
    if hasattr(data, "toPandas"):
        pdf = data.toPandas()
        return pdf.to_dict(orient="records"), list(pdf.columns), "spark"
    if isinstance(data, list):
        headers = list(data[0].keys()) if data else []
        return deepcopy(data), headers, "records"
    if isinstance(data, dict) and "rows" in data and "headers" in data:
        return deepcopy(data["rows"]), list(data["headers"]), "dataset"
    raise TypeError("Unsupported data type. Use Pandas DataFrame, Spark DataFrame, list of dicts, or dataset dict.")


def _from_records(records: list[dict[str, Any]], headers: list[str], kind: str) -> Any:
    if kind == "pandas":
        import pandas as pd

        return pd.DataFrame(records, columns=headers)
    return {"headers": headers, "rows": records}


def _profile_column(name: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    values = [row.get(name) for row in records]
    present = [value for value in values if not _is_null(value)]
    numeric = [_to_float(value) for value in present if _to_float(value) is not None]
    strings = [value for value in present if isinstance(value, str)]
    col_type = "numeric" if present and len(numeric) / len(present) >= 0.85 else "categorical"
    unique = sorted({str(value).strip() for value in present})
    return {
        "name": name,
        "normalizedName": _normalize_header(name),
        "type": col_type,
        "missingCount": len(values) - len(present),
        "missingRate": (len(values) - len(present)) / len(values) if values else 0,
        "uniqueCount": len(unique),
        "examples": unique[:6],
        "leadingOrTrailingSpaces": sum(1 for value in strings if value != value.strip()),
        "caseVariants": _case_variants(strings),
        "outliers": _outliers(numeric) if col_type == "numeric" else [],
    }


def _quality_issues(headers, columns, duplicate_rows, correlations):
    issues = []
    for column in columns:
        if column["name"] != column["normalizedName"]:
            issues.append({"type": "messy_header", "column": column["name"], "severity": "low"})
        if column["missingCount"]:
            issues.append({"type": "missing_values", "column": column["name"], "severity": "medium"})
        if column["leadingOrTrailingSpaces"]:
            issues.append({"type": "whitespace", "column": column["name"], "severity": "low"})
        if column["caseVariants"]:
            issues.append({"type": "categorical_inconsistency", "column": column["name"], "severity": "medium"})
        if column["outliers"]:
            issues.append({"type": "outliers", "column": column["name"], "severity": "medium"})
    if duplicate_rows:
        issues.append({"type": "duplicates", "severity": "medium"})
    for corr in correlations[:3]:
        issues.append({"type": "correlation", "severity": "info", **corr})
    return issues


def _apply(dataset, action):
    rows = dataset["rows"]
    headers = dataset["headers"]
    column = action.get("column")
    if action["type"] == "rename_header" and column in headers:
        new = action["newName"]
        for row in rows:
            row[new] = row.pop(column)
        return {"headers": [new if h == column else h for h in headers], "rows": rows}
    column = _resolve_column(headers, column)
    if action["type"] == "trim_whitespace":
        for row in rows:
            if isinstance(row.get(column), str):
                row[column] = row[column].strip()
    elif action["type"] == "standardize_case":
        for row in rows:
            if isinstance(row.get(column), str):
                row[column] = row[column].strip().lower()
    elif action["type"] == "impute_null":
        present = [row.get(column) for row in rows if not _is_null(row.get(column))]
        replacement = median([float(v) for v in present]) if action.get("strategy") == "median" and present else _mode(present)
        for row in rows:
            if _is_null(row.get(column)):
                row[column] = replacement
    elif action["type"] == "drop_column" and column in headers:
        headers = [h for h in headers if h != column]
        for row in rows:
            row.pop(column, None)
    elif action["type"] == "remove_duplicates":
        seen = set()
        deduped = []
        for row in rows:
            key = tuple(sorted(row.items()))
            if key not in seen:
                seen.add(key)
                deduped.append(row)
        rows = deduped
    elif action["type"] == "flag_outliers":
        vals = [_to_float(row.get(column)) for row in rows]
        out = set(_outliers([v for v in vals if v is not None]))
        flag = f"{_normalize_header(column)}_is_outlier"
        if flag not in headers:
            headers.append(flag)
        for row in rows:
            row[flag] = _to_float(row.get(column)) in out
    return {"headers": headers, "rows": rows}


def _resolve_column(headers, column):
    if not column or column in headers:
        return column
    normalized = _normalize_header(column)
    return next((header for header in headers if _normalize_header(header) == normalized), column)


def _analysis_suggestions(data_profile, use_case):
    numeric = [c for c in data_profile["columns"] if c["type"] == "numeric"]
    categorical = [c for c in data_profile["columns"] if c["type"] == "categorical"]
    suggestions = []
    if numeric and categorical:
        suggestions.append(f'Compare "{numeric[0]["normalizedName"]}" across "{categorical[0]["normalizedName"]}".')
    if data_profile["correlations"]:
        corr = data_profile["correlations"][0]
        suggestions.append(f'Investigate correlation between "{corr["left"]}" and "{corr["right"]}".')
    if any(c["missingCount"] for c in data_profile["columns"]):
        suggestions.append("Run missingness analysis before modeling.")
    if use_case:
        suggestions.append(f"Build a focused analysis dataset for: {use_case}.")
    return suggestions


def _action(idx, action_type, column, **extra):
    return {"id": f"clean_{idx}", "type": action_type, "column": column, "confidence": 0.95 if extra.get("risk") == "low" else 0.78, **extra}


def _score(data_profile):
    severity = {"high": 12, "medium": 7, "low": 3, "info": 1}
    return max(0, 100 - sum(severity.get(issue.get("severity"), 1) for issue in data_profile["qualityIssues"]))


def _normalize_header(header):
    return re.sub(r"_+", "_", re.sub(r"[^a-zA-Z0-9]+", "_", str(header).strip())).strip("_").lower()


def _tokens(text):
    return re.findall(r"[a-z0-9]+", str(text).lower())


def _relevance(column, terms):
    haystack = set(_tokens(" ".join([column["name"], column["normalizedName"], *column["examples"]])))
    return sum(1 for term in terms if term in haystack)


def _is_null(value):
    return value is None or str(value).strip().lower() in NULL_LIKE


def _to_float(value):
    try:
        if _is_null(value):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _case_variants(values):
    groups = {}
    for value in values:
        groups.setdefault(value.strip().lower(), set()).add(value.strip())
    return [sorted(v) for v in groups.values() if len(v) > 1]


def _duplicate_indexes(records):
    seen = set()
    duplicates = []
    for index, row in enumerate(records):
        key = tuple(sorted(row.items()))
        if key in seen:
            duplicates.append(index)
        seen.add(key)
    return duplicates


def _outliers(values):
    if len(values) < 4:
        return []
    sorted_values = sorted(values)
    q1 = _quantile(sorted_values, 0.25)
    q3 = _quantile(sorted_values, 0.75)
    iqr = q3 - q1
    low = q1 - 1.5 * iqr
    high = q3 + 1.5 * iqr
    return [value for value in values if value < low or value > high]


def _correlations(columns, records):
    numeric = [c["name"] for c in columns if c["type"] == "numeric"]
    output = []
    for i, left in enumerate(numeric):
        for right in numeric[i + 1 :]:
            pairs = [(_to_float(row.get(left)), _to_float(row.get(right))) for row in records]
            pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
            if len(pairs) >= 3:
                corr = _correlation([a for a, _ in pairs], [b for _, b in pairs])
                if abs(corr) >= 0.7:
                    output.append({"left": left, "right": right, "correlation": corr})
    return sorted(output, key=lambda c: abs(c["correlation"]), reverse=True)


def _correlation(a, b):
    mean_a = sum(a) / len(a)
    mean_b = sum(b) / len(b)
    numerator = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
    denom_a = math.sqrt(sum((x - mean_a) ** 2 for x in a))
    denom_b = math.sqrt(sum((y - mean_b) ** 2 for y in b))
    return numerator / (denom_a * denom_b) if denom_a and denom_b else 0


def _quantile(sorted_values, q):
    pos = (len(sorted_values) - 1) * q
    base = int(pos)
    rest = pos - base
    if base + 1 >= len(sorted_values):
        return sorted_values[base]
    return sorted_values[base] + rest * (sorted_values[base + 1] - sorted_values[base])


def _mode(values):
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return max(counts.items(), key=lambda item: item[1])[0] if counts else ""
