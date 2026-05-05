# Data Quality Radar

[![Profile](https://img.shields.io/badge/Profile-harshith444-111827?style=for-the-badge&logo=github&logoColor=white)](https://github.com/harshith444)
[![Repository](https://img.shields.io/badge/Repository-data--quality--radar-F59E0B?style=for-the-badge&logo=github&logoColor=111827)](https://github.com/harshith444/data-quality-radar)

A notebook-first data quality and self-cleaning agent that profiles datasets, understands the analysis use case, suggests cleaning actions, previews impact, applies approved fixes, and recommends next analysis steps.

## Features

- Data quality score from multiple checks
- Missing value detection
- Duplicate business key detection
- Schema drift comparison against a baseline dataset
- Freshness monitoring
- Revenue outlier detection
- Browser dashboard and JSON API
- Self-cleaning plan generation
- Jupyter-style Python package: `radar.profile`, `radar.plan`, `radar.preview`, `radar.clean`, `radar.run`
- Databricks-ready Spark adapter path through `radar.run(spark_df, ...)`
- OpenAI provider adapter with deterministic fallback
- Use-case-aware analysis suggestions
- Local/S3/Azure/Snowflake connector readiness model
- No external dependencies

## What Makes This Different

This is not a generic chatbot for data. The project is designed as a data-prep agent that runs inside real workflows.

- The user runs the agent once on a dataframe or table.
- The agent profiles the data and finds quality issues.
- The LLM layer is used for planning, not unsafe direct mutation.
- Deterministic code applies approved fixes.
- Every change is explainable and repeatable.
- It returns cleaned data, a report, generated notebook cells, and suggested next analysis.

## Notebook Usage

```python
import radar

result = radar.run(df, use_case="predict churn", mode="balanced", apply=False)

result.profile
result.plan
result.preview
result.notebook_cells
```

Apply approved fixes:

```python
cleaned = radar.clean(df, result.plan)
```

In a Databricks-style workflow, the same API can accept a Spark DataFrame if the runtime supports `toPandas()`:

```python
result = radar.run(spark_df, use_case="analyze revenue quality")
```

## Run Locally

```bash
npm start
```

Open `http://localhost:3001`.

## Test

```bash
npm test
```

## API

- `GET /api/report` returns the quality report.
- `GET /api/rows` returns the current dataset rows.
- `POST /api/profile` profiles a dataset for a use case.
- `POST /api/cleaning-plan` returns a structured cleaning plan.
- `POST /api/cleaning-preview` previews before/after quality impact.
- `POST /api/apply-cleaning` applies approved fixes and returns an audit report.
- `POST /api/analysis-suggestions` returns recommended next analyses.
- `GET /api/connectors` returns local/S3/Azure/Snowflake readiness.

## Stack

Node.js, JavaScript, Python, CSV rules engine, notebook agent API, OpenAI provider adapter, HTML, CSS.

## Links

- Profile README: [github.com/harshith444](https://github.com/harshith444)
- Companion project: [AI Insight Copilot](https://github.com/harshith444/ai-insight-copilot)
