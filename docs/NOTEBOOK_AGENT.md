# Notebook Agent Guide

Data Quality Radar is designed to run where analysts and data engineers already work: notebooks and data platforms.

## Main Idea

Instead of prompting a generic copilot again and again, run:

```python
import radar

result = radar.run(df, use_case="predict churn")
```

The agent performs the workflow:

```text
profile data
  -> detect quality issues
  -> understand use case
  -> suggest cleaning actions
  -> preview before/after impact
  -> apply approved fixes
  -> recommend next analysis
```

## Python API

```python
radar.profile(data, use_case="")
radar.plan(data, use_case="", mode="balanced")
radar.preview(data, cleaning_plan)
radar.clean(data, cleaning_plan)
radar.run(data, use_case, mode="balanced", apply=False)
radar.to_notebook_cells(cleaning_plan)
```

## Supported Data Inputs

Current implementation:

- list of dictionaries
- internal dataset dictionary
- Pandas DataFrame when Pandas is installed
- Spark DataFrame path through `toPandas()` in Databricks-style runtimes

Planned connector sources:

- S3 files
- Azure Blob / ADLS files
- Snowflake tables

## What The Agent Returns

`radar.run(...)` returns:

- `cleaned_data`
- `profile`
- `plan`
- `preview`
- `report`
- `notebook_cells`

## Safety Model

The agent does not silently overwrite original data.

Safe fixes are separated from fixes requiring approval. In `apply=False` mode, the agent only returns the plan and preview. In `apply=True` mode, recommended fixes are approved and applied to a copy.

## AI Model Role

The OpenAI adapter is designed for planning only.

The model should receive:

- profile metadata
- issue summaries
- sample values
- use-case description

The model should not receive full large datasets by default.

Actual cleaning is performed by deterministic Python or JavaScript code.
