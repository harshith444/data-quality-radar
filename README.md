# Data Quality Radar

A browser dashboard and API that scores dataset quality across completeness, uniqueness, schema drift, freshness, and anomalies.

## Features

- Data quality score from multiple checks
- Missing value detection
- Duplicate business key detection
- Schema drift comparison against a baseline dataset
- Freshness monitoring
- Revenue outlier detection
- Browser dashboard and JSON API
- No external dependencies

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

## Stack

Node.js, JavaScript, CSV rules engine, HTML, CSS.
