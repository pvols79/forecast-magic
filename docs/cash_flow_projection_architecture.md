# Cash Flow Projection Architecture

```text
Lunch Money v2
      |
      v
Local Node API Adapter
      |
      v
Normalized Accounts + CashFlowEvents
      |
      v
Ledger Projection Engine ------------------+
                                            |
SQLite -> Fund Allocation Engine -----------+-> Available-to-Spend Projection
                                                    |
                                                    +----> Chart + tooltip
                                                    |
                                                    +----> Key Events
```

## Lunch Money Boundary

`server/services/lunchMoneyService.js` owns remote API access. The browser calls the same-origin local REST API and never needs direct access to Lunch Money.

The service calls manual accounts, Plaid accounts, categories, recurring items, and transactions with pending activity included. It preserves the Phase I normalized account identity and internal amount convention.

Lunch Money transaction amounts are inverted once at this boundary:

- Positive internal amount means cash enters the selected account.
- Negative internal amount means cash leaves the selected account.

Transactions include their Lunch Money `category_id` so the Fund Allocation layer can evaluate mappings without embedding Fund policy into the ledger engine.

## Ledger Projection

`src/projection.js` remains the ledger-event engine. It handles account filtering, pending and future activity, recurring matching, missed recurring obligations, daily closing balances, Key Events, and negative-balance candidates.

Missed recurring occurrences on or before the anchor still reduce the opening projection and appear in the carousel. Fund Allocations do not enter this engine as `CashFlowEvent` objects.

## Available-To-Spend Layer

`src/availableToSpend.js` combines each projected ledger day with the corresponding reserved Fund amount:

```text
availableBalance = ledgerBalance - reservedOperationalFunds
```

The existing chart displays only `availableBalance`. Admin receives the latest actual Lunch Money account balance separately; there is no second chart line.

Fund Allocation state and boundary annotations are passed directly to chart tooltips. They are never added to `keyEvents`, so the recurring carousel remains focused on financial events.

## Account Identity

Every normalized account and event uses a compound key:

- `manual:<id>`
- `plaid:<id>`

Funds store the same `account_key`. The backend and both projection layers filter by this key, preventing another account's Funds or transactions from affecting the selected account.

## Persistence

SQLite stores settings, Funds, category mappings, exclusions, and one current-period checkpoint per Fund. Repository classes isolate SQL from business logic.

The checkpoint is overwritten as periods advance. Completed Fund periods and copies of Lunch Money transactions are not retained. Its only purpose is carrying the minimum rollover state into the current period.

Versioned SQL migrations run at server startup. In Docker, `/data/app.db` must be backed by a volume.

## Local Preferences

Only non-authoritative UI preferences remain in browser `localStorage`:

- Selected account
- Projection horizon

Fund Allocations, timezone, exclusions, and the fallback API key are authoritative in SQLite and therefore shared across browsers and machines using the same installation.
