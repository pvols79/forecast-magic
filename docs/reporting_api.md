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

Optional query parameter:

- `anchorDate=YYYY-MM-DD` calculates a deterministic report for that date. When omitted, the installation timezone determines today.

The response has this stable top-level shape:

```json
{
  "schemaVersion": "1.0",
  "reportDate": "2026-08-14",
  "generatedAt": "2026-08-14T12:00:00.000Z",
  "account": {},
  "cashPosition": {
    "availableToday": {},
    "thirtyDayLow": {},
    "ninetyDayLow": {},
    "sixMonthSnapshot": {},
    "projectionSeries": []
  },
  "needsAttention": {
    "pastDueRecurring": [],
    "dueWithin48Hours": []
  },
  "spendingTrends": {},
  "unallocatedSpending": {},
  "funds": []
}
```

Currency values use integer cents. `cashPosition.projectionSeries` contains one point per projection date with available-to-spend, ledger-balance, and reserved-Fund values. Fund cards include only Household-visible Funds and do not expose their transaction details.

## n8n

Use an HTTP Request node with:

- Method: `GET`
- URL: `https://your-local-cashflow-host/api/reporting/daily-highlight`
- Query parameter: `accountKey` with the selected compound account key
- Authentication: Bearer token using `REPORTING_API_TOKEN`
- Response format: JSON

A minimal workflow is:

```text
Schedule Trigger -> HTTP Request -> Format HTML or Markdown -> Deliver
```

Keep financial classification and projection rules in Forecast Magic. n8n should consume the returned decisions rather than infer recurring status, Fund membership, or unallocated spending itself.
