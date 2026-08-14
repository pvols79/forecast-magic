# Reporting Readiness Audit

This audit covers the structured data required by the Daily Financial Highlight specification. No report UI is implemented. Reusable calculations live in `server/domain/financialAnalytics.js`, orchestration lives in `server/services/financialAnalyticsService.js`, and the browser/server API contract is:

```text
GET /api/analytics/overview?accountKey=plaid:123&anchorDate=2026-08-14
```

`anchorDate` is optional. When omitted, the installation timezone determines today. Currency values are returned as integer cents.

The token-protected automation contract is `GET /api/reporting/daily-highlight`. It reuses these calculations and adds a schema version, report date, and complete six-month daily projection series. See `docs/reporting_api.md`.

## Metric Matrix

| Section | Metric | Before audit | Structured source after audit |
| --- | --- | --- | --- |
| Cash Position | Available today | Present in the browser projection as `openingBalance.availableToSpend` and the first daily balance. | `cashPosition.availableToday` |
| Cash Position | 30-day low | Derivable from browser daily balances, but not exposed as a metric. | `cashPosition.thirtyDayLow` |
| Cash Position | 90-day low | Derivable only when the selected UI horizon was long enough. | `cashPosition.ninetyDayLow` |
| Cash Position | 6-month projection snapshot | The UI slider could produce it, but no service guaranteed a six-month horizon. | `cashPosition.sixMonthSnapshot`; the analytics service always builds a six-month projection. `cashPosition.projectionSeries` exposes every daily point for automation. |
| Needs Attention | Past-due recurring items | Present as missed recurring projection events, but not exposed as a dedicated server collection. | `needsAttention.pastDueRecurring` |
| Needs Attention | Recurring expenses due within 48 hours | Expected recurring dates and matching details were not preserved in a reusable schedule shape. | `needsAttention.dueWithin48Hours` |
| Spending Trends | Top 3 categories over a rolling 30 days | Transaction category IDs existed; category metadata and aggregation were not joined. | `spendingTrends.topCategories` |
| Spending Trends | Gas trend | Not available. | `spendingTrends.tracked.gas` |
| Spending Trends | Dining trend | Not available. | `spendingTrends.tracked.dining` |
| Spending Trends | Groceries trend | Not available. | `spendingTrends.tracked.groceries` |
| Unallocated Spending | 30-day total | Not available. | `unallocatedSpending.totalCents` |
| Unallocated Spending | Top 5 expenditures | Not available. | `unallocatedSpending.topExpenditures` |
| Unallocated Spending | Largest expense | Not available. | `unallocatedSpending.largestExpense` |
| Unallocated Spending | Top payee | Not available. | `unallocatedSpending.topPayee` |
| Funds | Household-visible Fund cards | Present in the Household Fund Allocations projection response. | `funds` contains a stable, transaction-free card shape. |

## Definitions

### Cash position

Cash metrics use the existing normalized cash-flow projection and then subtract all Fund Allocation commitments. The 30-day and 90-day lows are forward-looking minimum available balances, including the anchor date. The six-month snapshot is the available balance on the final projection date.

### Needs attention

Lunch Money recurring matching remains authoritative. A past-due item is a missing recurring occurrence before the anchor date. Due within 48 hours includes recurring expenses from the anchor date through two calendar days after it only when they do not yet have a matched transaction. These upcoming obligations retain an `expected` or `missing` status; matched occurrences and recurring income are excluded.

### Spending trends

Top categories use the rolling 30-day window ending on the anchor date. Spending trends compare that same rolling window with the immediately preceding 30-day window. Pending, future, income, recurring-placeholder, and `exclude_from_totals` category transactions are omitted.

The named trend groups resolve Lunch Money categories by normalized category or group name:

- Gas: `Auto Fuel`, `Fuel`, `Gas`, or `Gasoline`
- Dining: `Dining`, `Dining Out`, `Fast Food`, `Restaurant`, or `Restaurants`
- Groceries: `Grocery` or `Groceries`

Each trend exposes matched category IDs, current and previous totals, change in cents, percentage change when a previous total exists, and direction.

### Unallocated spending

Unallocated means money spent without either supported planning relationship:

1. The transaction has no Lunch Money `recurring_id`.
2. Its category is not mapped to any active Fund Allocation for the selected account.

No payee, amount, or date heuristics are used to infer recurring relationships. Transactions tied to a Fund remain allocated even after that Fund reaches zero. Posted expenses only are included; pending, future, recurring-placeholder, income, transfer-like `exclude_from_totals`, and other-account transactions are omitted.

`topPayee` is ranked by total unallocated spending and includes both total cents and transaction count.

### Fund cards

Only Fund Allocations marked visible to Household are returned. Cards contain identity, type, period, current remaining amount, optional goal, and scheduled allocation. Transaction details and hidden Fund identities are not included.
