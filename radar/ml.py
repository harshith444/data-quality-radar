from __future__ import annotations

import math
import re
from statistics import mean
from typing import Any


def build_ml_insights(data: Any, data_profile: dict[str, Any], use_case: str = "") -> dict[str, Any]:
    records = _records(data)
    target = infer_target_column(data_profile, use_case)
    numeric = [column for column in data_profile["columns"] if column["type"] == "numeric"]
    categorical = [column for column in data_profile["columns"] if column["type"] == "categorical"]

    return {
        "targetColumn": target,
        "featureRanking": rank_features(records, numeric, categorical, target, use_case),
        "anomalySignals": anomaly_signals(records, numeric),
        "correlationSignals": data_profile.get("correlations", []),
        "nextAnalysis": next_analysis(data_profile, target, use_case),
        "modelNote": "Pure-Python statistical ML heuristics. No hosted model or sklearn dependency required."
    }


def infer_target_column(data_profile: dict[str, Any], use_case: str = "") -> str | None:
    terms = set(_tokens(use_case))
    best = None
    best_score = 0
    for column in data_profile["columns"]:
        name_terms = set(_tokens(column["name"] + " " + column["normalizedName"]))
        score = len(terms & name_terms)
        if "churn" in terms and "churn" in name_terms:
            score += 5
        if {"target", "label", "outcome"} & name_terms:
            score += 3
        if score > best_score:
            best = column["name"]
            best_score = score
    return best


def rank_features(records: list[dict[str, Any]], numeric: list[dict[str, Any]], categorical: list[dict[str, Any]], target: str | None, use_case: str) -> list[dict[str, Any]]:
    terms = set(_tokens(use_case))
    features = []
    for column in numeric + categorical:
        if column["name"] == target:
            continue
        score = column.get("relevance", 0)
        score += len(terms & set(_tokens(column["name"] + " " + column["normalizedName"]))) * 2
        if target:
            score += target_relationship_score(records, column["name"], target, column["type"])
        if column["missingRate"] < 0.2:
            score += 0.5
        if column["uniqueCount"] > 1:
            score += 0.5
        features.append({
            "column": column["normalizedName"],
            "sourceColumn": column["name"],
            "type": column["type"],
            "score": round(score, 3),
            "reason": feature_reason(column, target)
        })
    return sorted(features, key=lambda item: item["score"], reverse=True)


def anomaly_signals(records: list[dict[str, Any]], numeric: list[dict[str, Any]]) -> list[dict[str, Any]]:
    signals = []
    for column in numeric:
        values = [_float(row.get(column["name"])) for row in records]
        values = [value for value in values if value is not None]
        if len(values) < 4:
            continue
        avg = mean(values)
        sd = math.sqrt(sum((value - avg) ** 2 for value in values) / len(values)) or 1
        outliers = [
            {"value": value, "zScore": round((value - avg) / sd, 3)}
            for value in values
            if abs((value - avg) / sd) >= 2
        ]
        if outliers:
            signals.append({
                "column": column["normalizedName"],
                "sourceColumn": column["name"],
                "method": "z_score",
                "outliers": outliers[:10]
            })
    return signals


def target_relationship_score(records: list[dict[str, Any]], feature: str, target: str, feature_type: str) -> float:
    target_values = [str(row.get(target, "")).strip().lower() for row in records]
    positive = most_common(target_values)
    if not positive:
        return 0

    if feature_type == "numeric":
        pos = [_float(row.get(feature)) for row in records if str(row.get(target, "")).strip().lower() == positive]
        neg = [_float(row.get(feature)) for row in records if str(row.get(target, "")).strip().lower() != positive]
        pos = [value for value in pos if value is not None]
        neg = [value for value in neg if value is not None]
        if not pos or not neg:
            return 0
        spread = abs(mean(pos) - mean(neg))
        denom = abs(mean(pos + neg)) or 1
        return min(4, spread / denom * 4)

    groups = {}
    for row, target_value in zip(records, target_values):
        key = str(row.get(feature, "")).strip().lower()
        groups.setdefault(key, []).append(target_value == positive)
    if len(groups) <= 1:
        return 0
    rates = [sum(values) / len(values) for values in groups.values() if values]
    return min(4, (max(rates) - min(rates)) * 4) if rates else 0


def next_analysis(data_profile: dict[str, Any], target: str | None, use_case: str) -> list[str]:
    numeric = [column for column in data_profile["columns"] if column["type"] == "numeric"]
    categorical = [column for column in data_profile["columns"] if column["type"] == "categorical"]
    ideas = []
    if target:
        ideas.append(f"Build a target distribution view for {target}.")
        ideas.append(f"Rank features by relationship to {target}.")
    if numeric and categorical:
        ideas.append(f"Compare {numeric[0]['normalizedName']} across {categorical[0]['normalizedName']}.")
    if data_profile.get("correlations"):
        top = data_profile["correlations"][0]
        ideas.append(f"Investigate correlation between {top['left']} and {top['right']}.")
    if use_case:
        ideas.append(f"Create a cleaned modeling dataset for: {use_case}.")
    return ideas


def feature_reason(column: dict[str, Any], target: str | None) -> str:
    if target:
        return f"Scored for relationship to target {target}, completeness, and use-case relevance."
    return "Scored for completeness, variability, and use-case relevance."


def _records(data: Any) -> list[dict[str, Any]]:
    if hasattr(data, "to_dict") and hasattr(data, "columns"):
        return data.to_dict(orient="records")
    if hasattr(data, "toPandas"):
        return data.toPandas().to_dict(orient="records")
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "rows" in data:
        return data["rows"]
    return []


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", str(text).lower())


def _float(value: Any) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def most_common(values: list[str]) -> str | None:
    counts = {}
    for value in values:
        if value:
            counts[value] = counts.get(value, 0) + 1
    return max(counts.items(), key=lambda item: item[1])[0] if counts else None
