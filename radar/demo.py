from __future__ import annotations

import radar


DEMO_ROWS = [
    {" Customer ID ": " C001 ", " Segment ": " enterprise ", " Revenue ": "1200.00", " Churn Flag ": "No", " Empty ": ""},
    {" Customer ID ": " C002 ", " Segment ": "Enterprise", " Revenue ": "", " Churn Flag ": "no", " Empty ": ""},
    {" Customer ID ": " C003 ", " Segment ": "SMB ", " Revenue ": "0.00", " Churn Flag ": "YES", " Empty ": ""},
    {" Customer ID ": " C003 ", " Segment ": "SMB ", " Revenue ": "0.00", " Churn Flag ": "YES", " Empty ": ""},
    {" Customer ID ": " C004 ", " Segment ": "mid market", " Revenue ": "150000.00", " Churn Flag ": "N", " Empty ": ""},
]


def run_demo() -> str:
    result = radar.run(DEMO_ROWS, use_case="predict churn and understand revenue quality", apply=True)
    lines = [
        "Data Quality Radar Demo",
        "=======================",
        f"Rows scanned: {result.profile['rowCount']}",
        f"Columns scanned: {result.profile['columnCount']}",
        f"Quality issues found: {len(result.profile['qualityIssues'])}",
        f"Before score: {result.preview['beforeScore']}",
        f"After score: {result.preview['afterScore']}",
        "",
        "Top cleaning actions:",
    ]
    for action in (result.plan["safeAutoFixes"] + result.plan["recommendedActions"])[:8]:
        lines.append(f"- {action['type']} :: {action.get('column') or 'dataset'} :: {action['reason']}")

    lines.extend(["", "ML-style insights:"])
    for feature in result.ml_insights["featureRanking"][:5]:
        lines.append(f"- {feature['column']} ({feature['type']}) score={feature['score']}: {feature['reason']}")

    lines.extend(["", "Next analysis suggestions:"])
    for idea in result.ml_insights["nextAnalysis"]:
        lines.append(f"- {idea}")

    lines.extend(["", "Notebook cells generated:"])
    for cell in result.notebook_cells[:8]:
        lines.append(f">>> {cell}")
    return "\n".join(lines)
