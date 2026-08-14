# Fund Allocations Architecture

## Domain Boundary

Fund Allocations represent reserved cash policy. They are not Lunch Money transactions and do not mutate Lunch Money.

## Types

- **Operating**: a recurring period allocation for routine spending. Existing periodic Funds migrate to this type and retain their current rollover behavior.
- **Reserved**: an editable all-time reservation. Existing all-time Funds migrate to this type.
- **Sinking**: a persistent balance with full rollover, an optional scheduled contribution, optional category drawdown, and an optional goal.

Scheduled Sinking contributions are added at period boundaries. When a goal exists, each contribution is capped at the amount needed to reach that goal. Contributions stop while the goal is met and resume at the next boundary after category spending lowers the balance.

## Transaction drawdown

Qualifying Lunch Money transactions are sorted by date and transaction ID. Each row retains its starting balance, eligible spending, covered amount, over-budget amount, and ending balance. Rows remain in the list after the balance reaches zero. Excluded rows remain visible but do not draw down the allocation.

Admin receives the complete transaction details and can manage exclusions. Household receives a reduced read-only transaction shape only for Funds marked visible to Household. Hidden Fund details stay private while their reserved amounts remain included in the aggregate available-to-spend calculation.

```text
Projected Ledger Balance
          -
Daily Fund Allocation Reserve
          =
Available-to-Spend Balance
```

The pure engine is in `server/domain/operationalFunds.js`. Financial period calculations are in `server/domain/periods.js`. SQL is isolated under `server/repositories`.

## Data Model

`operational_funds` stores account ownership, allocation, period configuration, rollover policy, optional target, visibility, and active state.

`operational_fund_categories` stores Lunch Money category IDs. The repository rejects a category assigned to two active Funds for the same account.

`operational_fund_exclusions` stores only a Fund ID and Lunch Money transaction ID. It does not copy financial transaction data.

`operational_fund_current_state` contains one replaceable row per Fund:

- Current period start and end
- Allocation used in that current period
- Carry-in
- Remaining amount
- Date through which it was calculated

When a period ends, the same row advances. There is no completed-period reporting history.

## Drawdown

The backend requests live Lunch Money transactions beginning at the earliest active Fund checkpoint or current period boundary. A transaction draws down a Fund only when:

- Its compound account key matches.
- Its category ID is mapped to the Fund.
- It is a real actual, pending, or future-dated Lunch Money transaction represented by the ledger projection.
- It is not excluded from that Fund.
- It is an expense under the normalized internal sign convention.

The remaining amount is clamped at zero. All matching transactions remain visible in the Admin's live read-only transaction view, including excluded transactions and spending after the Fund reached zero.

Real pending and future-dated transactions draw a Fund down on their transaction date. Future recurring projections do not draw down Funds.

## Rollover

At a boundary:

```text
carry = 0                                  (no rollover)
carry = previous remaining                 (full rollover)
carry = min(previous remaining, cap)       (capped rollover)

new remaining = allocation + carry
future commitment delta = allocation
```

The Fund's period balance and its projected commitment are distinct. Rollover determines the new period's spendable Fund balance. Independently, every future period contributes one flat allocation to the chart's committed reserve. With 25 remaining and a 150 allocation, the new full-rollover Fund balance is 175 and the future projection adds only the new 150 commitment.

For a no-rollover Fund, the period balance resets to the standard allocation. The projection still retains prior period commitments as assumed spending and adds the next allocation. This gives a Weekly 125 Fund the same linear balance effect as a weekly recurring 125 expense, while allowing actual transactions to draw down each period's Fund and prevent double-counting.

## REST API

- `GET /api/funds?accountKey=...`
- `POST /api/funds`
- `GET /api/funds/:id`
- `PUT /api/funds/:id`
- `DELETE /api/funds/:id`
- `POST /api/funds/:id/exclusions`
- `DELETE /api/funds/:id/exclusions/:transactionId`
- `GET /api/funds/projection?accountKey=...&anchorDate=...&endDate=...`
- `GET /api/settings`
- `PUT /api/settings/timezone`

Fund mutation and category endpoints require the signed Admin session. Household projection responses retain the full reserved total while removing hidden Fund names, details, transaction lists, and annotations.

## Deployment

The production Node process serves the React build and REST API on one HTTP port. It opens SQLite, applies migrations, and serves `/api/health`.

For Docker, mount `/data` persistently. An external NGINX server may proxy HTTPS to the container's HTTP port. The application does not terminate TLS.
