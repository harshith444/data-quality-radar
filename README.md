# Data Quality Radar

[![Profile](https://img.shields.io/badge/Profile-harshith444-111827?style=for-the-badge&logo=github&logoColor=white)](https://github.com/harshith444)
[![Repository](https://img.shields.io/badge/Repository-data--quality--radar-F59E0B?style=for-the-badge&logo=github&logoColor=111827)](https://github.com/harshith444/data-quality-radar)

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

## Links

- Profile README: [github.com/harshith444](https://github.com/harshith444)
- Companion project: [AI Insight Copilot](https://github.com/harshith444/ai-insight-copilot)
