# Duplicate Review

Duplicate Review is an Admin-only maintenance workflow for likely pairs where a pending placeholder transaction is later imported from a financial institution.

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

Candidates must belong to the same compound account, have an exact signed Lunch Money API amount, contain one placeholder and one eligible Plaid import, and occur no more than five days apart. Placeholders are n8n/API rows tagged `n8n_proc` or manually created rows tagged `LM Manual`. Plaid imports already tagged `matched_import` are excluded. Payee similarity, category, recurring relationship, and date distance determine whether the candidate is labeled High, Medium, or Low; all confidence levels are shown.

Selecting **Not Duplicate** stores only the exact placeholder/imported transaction ID pair, account key, and ignored timestamp in SQLite. Lunch Money transaction history is not copied into the local database.

Selecting **Duplicate** keeps the imported transaction as the bank event. The service re-fetches and revalidates both transactions, updates the imported payee and selected metadata, removes pending-placeholder pipeline tags, adds `matched_import`, confirms that update, and only then deletes the placeholder transaction. An update failure prevents deletion. A deletion failure remains visible as an error and the candidate can be scanned again.

For transactions created early by n8n or another API integration, that deletion also retires the placeholder from cash-flow opening adjustments. The retained `matched_import` transaction remains normal cleared spending and is not treated as pending.

## APIs

The Admin session protects all review operations:

- `GET /api/duplicate-review/scan?accountKey=plaid:123`
- `POST /api/duplicate-review/ignore`
- `POST /api/duplicate-review/resolve`

The token-protected `GET /api/reporting/daily-highlight?accountKey=plaid:123&view=admin` response includes a non-destructive `duplicateReview` summary. It contains High- and Medium-confidence candidates, complete High/Medium/Low counts, and cannot resolve or ignore candidates. Household reports omit this section.
