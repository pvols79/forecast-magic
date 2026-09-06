# Financial Health Audit

Forecast Magic includes a read-only financial audit layer for reconciling the evidence available from Lunch Money, Capital One exports, n8n transaction alerts, and Forecast Magic's own projection inputs. The audit is designed for troubleshooting and conversational analysis. It never edits, deletes, merges, skips, or retags financial records.

## Evidence Model

The audit keeps three kinds of evidence separate:

1. **Lunch Money** supplies the selected account balance, imported and pending transactions, API-created placeholders, tags, recurring data, duplicate candidates, missed-recurring adjustments, and Fund Allocation reservations.
2. **Capital One CSV exports** supply an independent posted-transaction ledger. An optional current ledger or available balance can be supplied with the import.
3. **n8n evidence** records what an email alert said when an automation created a Lunch Money placeholder. This permits the later settled Plaid amount or payee to be compared with the original alert.

Forecast Magic does not connect directly to Plaid. Plaid troubleshooting is limited to the Plaid-derived account and transaction fields that Lunch Money exposes. A missing bank transaction is reported only when a recent Capital One export covers the relevant date; without that evidence, the result is marked unknown instead of making a claim.

## What An Audit Checks

Each run stores an immutable snapshot for one compound account key, such as `plaid:123`. It reports:

- Capital One versus Lunch Money balance comparison
- Imported, native-pending, n8n-created, and tagged-placeholder transaction totals
- n8n-created transaction candidates missing `Forecast Magic Pending`
- Suspicious use of the pending tag on non-n8n transactions
- Possible duplicates from the existing Duplicate Review rules
- Capital One transactions missing from Lunch Money when the bank evidence is current and date-covered
- Native pending and tagged placeholders still open beyond the configured business-day thresholds
- Amount, date, payee, or pending-state changes observed between audit snapshots
- n8n alert amounts that differ from a later settled Plaid transaction
- Fund Allocation reservations and missed-recurring/opening adjustments
- The remaining unexplained balance difference
- An overall status and confidence score

Statuses are:

- `healthy`: current bank evidence exists and no material issue is detected.
- `attention`: the audit found warnings or an unexplained balance difference of at least `$1.00`.
- `unreliable`: at least one critical finding is present.
- `not_assessable`: current Capital One evidence is unavailable, so a complete independent reconciliation cannot be made.

The score is a diagnostic aid, not a bank balance and not a guarantee that the forecast is correct. The response also returns the facts, findings, and unknowns used to reach the result.

## Configuration

Create two independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Set them in `.env` or the Docker Compose environment:

```text
AUDIT_READ_TOKEN=read-only-secret
AUDIT_INGEST_TOKEN=evidence-upload-secret
```

`AUDIT_READ_TOKEN` permits audit execution and retrieval. It also protects `/mcp`. `AUDIT_INGEST_TOKEN` permits Capital One and n8n evidence uploads. Do not provide the ingest token to ChatGPT.

Optional thresholds are:

```text
AUDIT_PENDING_WARNING_BUSINESS_DAYS=3
AUDIT_PENDING_CRITICAL_BUSINESS_DAYS=5
AUDIT_STATEMENT_FRESH_HOURS=36
```

The read and ingest REST routes also accept an active Admin browser session. MCP always requires the read-only Bearer token. Missing token configuration fails closed with HTTP `503`; a missing or incorrect credential returns HTTP `401`.

## REST API

All read requests use:

```http
Authorization: Bearer <AUDIT_READ_TOKEN>
```

Run and retrieve audits:

```http
POST /api/financial-audit/runs
Content-Type: application/json

{"accountKey":"plaid:123"}
```

```http
GET /api/financial-audit/runs/latest?accountKey=plaid:123
GET /api/financial-audit/runs/42
GET /api/financial-audit/balance-comparison?accountKey=plaid:123
GET /api/financial-audit/transactions?accountKey=plaid:123&source=plaid&pending=false
GET /api/financial-audit/findings?accountKey=plaid:123&severity=warning
GET /api/financial-audit/findings/finding-key?accountKey=plaid:123
GET /api/financial-audit/tag-compliance?accountKey=plaid:123
GET /api/financial-audit/sync-health?accountKey=plaid:123
```

`POST /runs` accepts an optional `anchorDate` in `YYYY-MM-DD` form. Transactions and findings are returned from the saved snapshot, so later Lunch Money changes do not rewrite prior audit history.

### Capital One Evidence

Preview a CSV before storing it:

```bash
curl -X POST \
  'https://forecast.example.com/api/financial-audit/evidence/capital-one/preview?accountKey=plaid:123&availableBalanceCents=960730' \
  -H 'Authorization: Bearer YOUR_AUDIT_INGEST_TOKEN' \
  -H 'Content-Type: text/csv' \
  -H 'X-Filename: capital-one.csv' \
  --data-binary @capital-one.csv
```

Commit the same evidence by removing `/preview` from the URL. CSV evidence is content-hashed and idempotent, so submitting the same file again does not duplicate its rows. Raw `text/csv` is preferred and supports files up to 10 MB. `ledgerBalanceCents`, `availableBalanceCents`, and `observedAt` are optional query parameters.

The importer recognizes Capital One's `Transaction Date`, `Transaction Description`, `Transaction Type`, `Transaction Amount`, and `Balance` columns, as well as common debit/credit column variants. Preview the file whenever its layout is unfamiliar.

### n8n Evidence

After n8n creates the Lunch Money placeholder, add an HTTP Request node that records the original alert:

```http
POST /api/financial-audit/evidence/n8n
Authorization: Bearer <AUDIT_INGEST_TOKEN>
Content-Type: application/json
```

```json
{
  "accountKey": "plaid:123",
  "externalId": "n8n-capone-gmail-message-id",
  "emailId": "gmail-message-id",
  "date": "2026-09-06",
  "amountCents": -2194,
  "payee": "Google",
  "statementDescription": "GOOGLE ONE",
  "lunchMoneyTransactionId": "456789"
}
```

Amounts follow Forecast Magic's internal convention: positive is money entering the account and negative is money leaving it. The endpoint is idempotent by account and `externalId`.

This evidence call complements the Lunch Money tags. The created Lunch Money transaction should continue to receive `Forecast Magic Pending` until Duplicate Review replaces it with the settled Plaid import.

## MCP Connector

Forecast Magic exposes a stateless, read-only Streamable HTTP MCP endpoint:

```text
https://forecast.example.com/mcp
```

Authenticate with:

```http
Authorization: Bearer <AUDIT_READ_TOKEN>
```

Available tools:

- `run_financial_health_audit`
- `get_latest_financial_health`
- `compare_capital_one_and_lunch_money`
- `list_financial_audit_findings`
- `inspect_financial_audit_finding`
- `list_audited_transactions`
- `check_forecast_magic_tags`
- `check_lunch_money_sync_health`

Every tool is declared read-only and non-destructive. The connector cannot upload statements, alter Lunch Money, resolve duplicates, reconnect Plaid, change Fund Allocations, or skip recurring occurrences.

ChatGPT must be able to reach the MCP URL. A server that is available only on a home LAN or VPN is not directly reachable by ChatGPT's hosted connector service. Keep using the REST API from local n8n immediately; for ChatGPT, use an intentionally configured secure tunnel or another remote HTTPS path with the read-only token. Do not expose the ingest token.

Custom MCP app availability depends on the ChatGPT plan and workspace settings. In ChatGPT developer mode, add the remote `/mcp` URL, configure authentication, scan the tools, and refresh the app whenever tool definitions change. The MCP endpoint can also be used by other compatible clients that support Streamable HTTP and Bearer authentication.

## Daily Highlight

After at least one audit has run, `/api/reporting/daily-highlight` includes a compact `financialHealth` object containing the latest run ID, timestamp, status, confidence score, finding counts, unexplained available-balance difference, and unknowns. If no audit exists, the report says `not_assessable` instead of running a potentially slow external audit during report generation.

## Recommended Routine

1. Keep the n8n pending tag and evidence call in the Capital One email workflow.
2. Import a fresh Capital One CSV and current available balance when a full reconciliation is needed.
3. Run the audit.
4. Review critical findings first, then warnings and unknowns.
5. Resolve data issues in Lunch Money or Duplicate Review, then run a new audit.
6. Retain prior runs as evidence of what was known at that time.

The audit is deliberately advisory. Financial decisions should ultimately be checked against the bank's current ledger and available balance.
