# Reporting API

The Reporting API is the automation boundary for n8n and similar local tools. It returns structured JSON; scheduling, formatting, and delivery remain the automation tool's responsibility.

## Configuration

Set a dedicated secret in `.env` or the Docker Compose environment:

```text
REPORTING_API_TOKEN=replace-with-a-separate-long-random-value
```

A suitable value can be generated with:

```bash
openssl rand -hex 32
```

This token is separate from both `ADMIN_PASSWORD` and `LUNCH_MONEY_API_KEY`. If it is missing, reporting requests fail with HTTP `503`. Missing or incorrect credentials receive HTTP `401`.

## Daily Highlight

```http
GET /api/reporting/daily-highlight?accountKey=plaid:123
Authorization: Bearer <REPORTING_API_TOKEN>
```

Optional query parameters:

- `anchorDate=YYYY-MM-DD` calculates a deterministic report for that date. When omitted, the installation timezone determines today.
- `view=admin|household` applies presentation filtering. The default is `admin` for compatibility with the 1.1 response, which included Duplicate Review.

The response has this stable top-level shape:

```json
{
  "schemaVersion": "1.2",
  "reportDate": "2026-08-14",
  "generatedAt": "2026-08-14T12:00:00.000Z",
  "reportContext": {
    "view": "admin",
    "timezone": "America/Chicago",
    "currency": "USD",
    "projectionHorizonDays": 184
  },
  "account": {},
  "cashPosition": {
    "availableToday": {},
    "thirtyDayLow": {},
    "ninetyDayLow": {},
    "sixMonthSnapshot": {},
    "sixMonthLow": {},
    "sixMonthHigh": {},
    "endingAvailable": {},
    "netAvailableChange": {},
    "projectionSeries": []
  },
  "needsAttention": {
    "pastDueRecurring": [],
    "dueWithin48Hours": []
  },
  "spendingTrends": {},
  "unallocatedSpending": {},
  "funds": [],
  "duplicateReview": {
    "window": {
      "startDate": "2026-07-16",
      "endDate": "2026-08-14"
    },
    "needsReview": 0,
    "confidenceCounts": {
      "high": 0,
      "medium": 0,
      "low": 0
    },
    "candidates": []
  }
}
```

Currency values, including duplicate candidate `amountCents` fields, use integer cents. `cashPosition.projectionSeries` contains one point per projection date with available-to-spend, ledger-balance, and reserved-Fund values. `sixMonthLow`, `sixMonthHigh`, and `endingAvailable` use the same projection-point shape. `netAvailableChange.amountCents` is the ending available amount minus the report-date available amount.

Needs-attention items include `daysPastDue`, `daysUntilDue`, and exactly one urgency value: `past_due`, `due_today`, `due_48h`, or `upcoming`. Non-applicable timing values are `null`.

Household reports include only Household-visible Fund cards and omit `duplicateReview`. Admin reports include all active selected-account Fund cards and the read-only Duplicate Review summary. Every Fund card includes `householdVisible`. Ignored duplicate pairs are excluded; High- and Medium-confidence candidates are listed, while `confidenceCounts.low` still reports the number of hidden Low-confidence suggestions. The reporting endpoint cannot resolve or ignore candidates.

## Ad Hoc PDF

The web application generates a current PDF through its normal application session:

```http
GET /api/reporting/daily-highlight.pdf?accountKey=plaid:123&view=household
```

`view=admin` requires a signed Admin session. Household PDF generation follows the existing Household access boundary. The endpoint streams `application/pdf` with a meaningful download filename and rebuilds the same Daily Highlight report model at request time. It does not accept or expose the reporting token, Lunch Money API key, or duplicate-resolution actions.

The `Share Report` menu in both application views can pass the PDF to the browser's file-sharing support, download it when file sharing is unavailable, or open the browser print dialog.

## n8n

Use an HTTP Request node with:

- Method: `GET`
- URL: `https://your-local-cashflow-host/api/reporting/daily-highlight`
- Query parameter: `accountKey` with the selected compound account key
- Query parameter: `view` set to `admin` or `household`
- Authentication: Bearer token using `REPORTING_API_TOKEN`
- Response format: JSON

A minimal workflow is:

```text
Schedule Trigger -> HTTP Request -> Format HTML or Markdown -> Deliver
```

Keep financial classification and projection rules in Forecast Magic. n8n should consume the returned decisions rather than infer recurring status, Fund membership, or unallocated spending itself.
