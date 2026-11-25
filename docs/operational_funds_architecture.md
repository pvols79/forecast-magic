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

## Funds workspace, sub-funds, and adjustments

Admin has a dedicated Funds view with a tabular overview, selected-fund summary,
sub-fund table, and an inline activity register. Fund listings and creation live
on the Funds tab rather than the Forecast page. Household uses the same tab for
its read-only visible Fund summaries. Settings live in a drawer. The register can show
current-period or all-time activity and filter to a child or the parent's own
portion. All-time spending is read live from Lunch Money from Fund creation;
allocation entries use recorded allocation history, not an invented historical
bank ledger. Category mappings reflect the current Fund configuration.

A Fund may have one level of children, in the same account. Children have their
own funding policy, category mappings, optional occasion date, and explicit
purchase-completion date. Spending is evidence for review, not proof that a gift
has been completed. Occasion dates identify a particular occasion; advance the
date and clear purchase completion when planning the next year.

Existing parent balances remain unassigned money. Children add their remaining
balances to the parent's displayed total. Forecast calculations still process
each underlying balance once, then roll up presentation to the parent. Parent
scheduled contributions enter the unassigned portion; child schedules contribute
to their respective children. Disabling a parent removes its entire family from
the forecast. Children must be moved or deleted before deleting a parent.

Reserved and Sinking Funds accept dated signed adjustment entries with a reason.
These do not create or modify Lunch Money transactions. Opening amounts remain
separate. The Admin adjustment endpoint dates entries in the installation's time
zone and rejects withdrawals above the Fund's own available balance. To partition
an existing balance, create a child with zero opening balance and move money from
the parent using a negative entry with a destination. Both entries are saved in
one database transaction. To correct an entry, record an opposite adjustment.
Scheduled balances with adjustments replay from opening so subsequent rollover
and goal-capped contributions include the adjustment exactly once.

- `GET /api/funds/:id/register` (Admin)
- `POST /api/funds/:id/adjustments` (Admin), with `amountCents`, `note`, and optional
  `transferToId` for a move between active Reserved or Sinking Funds on the same bank account, including other parent Funds and their sub-funds.

Sub-funds use `parent_id`; occasion and completion dates are optional metadata.
`operational_fund_adjustments` stores immutable local register entries. Hidden
children remain included in aggregate reserves but their transaction details are
removed from Household responses. Child names and local adjustment reasons are
not exposed in Household responses.

## Archiving

Archive hides a Fund from the current list and stops its reservation and scheduled
contributions without deleting settings, category mappings, exclusions, allocations,
or adjustment history. Parent archiving includes nonarchived children and preserves
which ones were enabled. The Archived funds view shows the last reserved balance
as a historical snapshot, not an amount still being held. Move money to another
Fund first if that reservation should continue. Deleting also releases the reserve,
but permanently removes the local Fund records; neither action moves bank money
or removes Lunch Money transactions.

Archive records its cutoff date using the installation time zone. Its register
omits later category activity. Spending remains a live read of Lunch Money, rather
than a frozen copy of bank records. Restore re-enables previously enabled members
and resumes normal balance calculation against current categories and schedules;
it rejects conflicts with categories reused by another enabled Fund. Separately
archived children are not restored with their parent. Archived Funds cannot have
settings, balance entries, or exclusions changed until restored.

- `POST /api/funds/:id/archive` (Admin)
- `POST /api/funds/:id/restore` (Admin)

## Prospective schedule activation and allocation corrections

When automatic allocation is enabled on a manual Fund, `schedule_started_on`
records the save date in the installation's time zone. Its first contribution is
at the next period boundary strictly after that date: an anchor later this month
can run this month, while an anchor already passed waits until its next occurrence.
The opening balance, previous category spending, and manual adjustments remain in
the balance; replay from Fund creation cannot generate contributions before schedule
activation. Existing schedules are not automatically rewritten by the migration.

Admin register allocation rows have **Remove allocation** with a confirmation.
Removal marks that Fund/period in `operational_fund_allocation_removals`, clears
its calculation checkpoint, and replays balances, carryover, and forecast reserves.
It does not touch Lunch Money transactions, manual adjustments, or other Funds.
The original amount remains visible with a Removed label and strikethrough, while
its effective contribution is zero. Repeated projections and restarts respect
that marker. Opening-balance entries are labeled separately and cannot be removed
as automatic allocations. Archived Funds must be restored before correction.
Historical contributions retain their recorded amounts on replay; the current
schedule amount applies to future contributions, rather than rewriting old funding.

`DELETE /api/funds/:id/allocations/:periodStart` requires Admin access and only
accepts a period with an existing recorded allocation. The normal projection
refresh updates the corrected Fund and parent totals.

## Including spending before Fund creation

Fund settings offer **Spending included in this fund**: **Since fund creation**
(the existing default) or **All category history**. `include_prior_spending` is
opt-in per Fund and sub-fund. With all history selected, the live LM query starts
at 1900-01-01 and includes matching category purchases and refunds from the same
bank account in both the full register and balance calculation. Transaction
exclusions still apply. This does not modify LM or create a copied spending ledger.
Changing a category in LM is reflected on a subsequent register/projection refresh.

Earlier category activity draws against the Fund's initial funding period, then
normal recorded contributions and rollover continue from the existing funding
baseline. Historical spending scope never moves automatic-allocation activation
backward or creates funding periods before the known schedule began. Operating
Funds still obey period resets and rollover, so spending from a completed period
in a no-rollover Fund does not reduce a later period's new allocation. For a
persistent gift or event balance, Reserved or Sinking is the appropriate type.

Changing this setting invalidates the calculation checkpoint. Other Funds retain
their prior spending scope. Earlier spending should only be included when the
opening amount has not already been reduced for those same purchases.
