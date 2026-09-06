# Duplicate Review

Duplicate Review is an Admin-only maintenance workflow for likely pairs where a manually created Lunch Money transaction is later imported from a financial institution.

## Architecture

```text
Lunch Money v2 transactions (rolling 30 days)
                    |
                    v
       Account and amount grouping
                    |
                    v
     Conservative confidence scoring
                    |
        +-----------+-----------+
        |                       |
        v                       v
Admin review UI          Daily Highlight summary
        |                  (read-only, High/Medium)
        v
Re-fetch and validate both transactions
        |
        v
Update imported metadata
        |
        v
Delete manual transaction
```

Candidates must belong to the same compound account, have an exact signed Lunch Money API amount, contain one `manual` and one `plaid` source transaction, and occur no more than three days apart. Payee similarity, category, and recurring relationships determine confidence. Low-confidence candidates are hidden unless the Admin requests them.

Selecting **Not Duplicate** stores only the exact manual/imported transaction ID pair, account key, and ignored timestamp in SQLite. Lunch Money transaction history is not copied into the local database.

Selecting **Duplicate** keeps the imported transaction as the bank event. The service re-fetches and revalidates both transactions, updates the imported payee and selected metadata, confirms that update, and only then deletes the manual transaction. An update failure prevents deletion. A deletion failure remains visible as an error and the candidate can be scanned again.

For transactions created early by n8n or another API integration, that deletion also retires the placeholder from cash-flow opening adjustments. Until resolution, the user/API-created transaction continues to affect available cash and an imported match remains visible as a duplicate rather than being silently removed by projection logic.

## APIs

The Admin session protects all review operations:

- `GET /api/duplicate-review/scan?accountKey=plaid:123&includeLow=false`
- `POST /api/duplicate-review/ignore`
- `POST /api/duplicate-review/resolve`

The token-protected `GET /api/reporting/daily-highlight?accountKey=plaid:123&view=admin` response includes a non-destructive `duplicateReview` summary. It contains High- and Medium-confidence candidates, complete High/Medium/Low counts, and cannot resolve or ignore candidates. Household reports omit this section.
