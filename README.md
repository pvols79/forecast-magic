# Forecast Magic

<p align="center">
  <img src="public/forecast-magic-logo.png" alt="Forecast Magic" width="280">
</p>

Forecast Magic is a self-hosted cash-flow forecasting application. It integrates with the Lunch Money API v2 to project a selected account's available-to-spend balance, then applies locally configured Fund Allocations as reservations that do not create or modify Lunch Money transactions.

Forecast Magic is independent software and is not affiliated with, endorsed by, or officially connected with Lunch Money or its developers.

## Features

- Single-account cash-flow projection
- Actual, pending, future-dated, and recurring Lunch Money activity
- Recurring occurrence matching and missed-recurring protection
- Available-to-spend chart and Key Events carousel
- Account-scoped Fund Allocations with Operating, Reserved, and Sinking types
- No, full, and capped rollover
- Lunch Money category drawdown and per-transaction exclusions
- Admin and read-only Household presentations
- Persistent SQLite configuration for use across browsers and machines
- Light and dark modes

## Requirements

- Node.js 22 or later
- npm
- A Lunch Money API key

## Install

```bash
git clone https://github.com/pvols79/cashflow-app-api-v2.git
cd cashflow-app-api-v2
npm install
```

Copy `.env.example` to `.env` and set at least an Admin password and session secret:

```text
PORT=3000
DATABASE_PATH=./data/app.db
ADMIN_PASSWORD=choose-a-password
SESSION_SECRET=choose-a-long-random-value
REPORTING_API_TOKEN=choose-a-separate-long-random-value
LUNCH_MONEY_API_KEY=
```

`LUNCH_MONEY_API_KEY` is optional. If omitted, an Admin can enter the key in the application. The entered key is stored in the installation's local SQLite database. An environment-provided key takes precedence and cannot be cleared from the UI.

## Production Run

```bash
npm run build
npm start
```

The application defaults to `http://localhost:3000`. The Node service serves both the built React application and its local REST API. It creates the SQLite database and runs pending migrations automatically.

## Development

Run the backend and Vite in separate terminals:

```bash
npm run dev:server
```

```bash
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to the backend on port 3000.

## Docker

For a standalone installation on the same machine:

```bash
cp .env.example .env
docker compose up --build -d
```

Open `http://localhost:3000`. By default, the published port is bound only to `127.0.0.1`; set `FORECAST_MAGIC_BIND_ADDRESS=0.0.0.0` only when direct LAN access is intentional.

For a dedicated Docker server with shared NGINX and Certbot services, use the supplied external-network Compose and NGINX examples. The app publishes no host port in that configuration. See [Docker Deployment](docs/docker_deployment.md) for both installation paths, HTTPS setup, updates, and backups.

SQLite is stored in the named `forecast-magic-data` volume at `/data/app.db`; no Postgres or separate SQLite container is used. HTTPS termination belongs in the optional external reverse proxy.

Back up the volume or database file before upgrades. Application startup applies versioned migrations without deleting existing data.

## Admin And Household

When `ADMIN_PASSWORD` is configured, unauthenticated users receive the Household presentation. The Admin password creates a signed, HTTP-only session cookie. This is intentionally a small shared-password boundary for a trusted local network or VPN, not a multi-user identity system.

Admin sees the same available-to-spend chart and carousel as Household, plus:

- Latest actual selected-account balance
- Total currently reserved in Fund Allocations
- Fund Allocation management
- Category mappings and transaction exclusions
- Timezone settings

Funds hidden from Household still reduce the Household available-to-spend value; only their names and details are hidden.

## Fund Allocations

Fund Allocations are reservation policy, not transactions. They never create fake financial events and never appear in Upcoming.

```text
Available to Spend = Projected Ledger Balance - Remaining Fund Allocations
```

Actual matching Lunch Money spending reduces both the account balance and the matching Fund. Real pending or future-dated Lunch Money spending does the same on its transaction date. This prevents reserved spending from reducing available-to-spend twice. A Fund stops at zero, and spending beyond zero reduces available-to-spend normally. Recurring projections reserve ledger cash but do not draw down Funds.

Every future periodic boundary adds one flat allocation to the available-to-spend projection. For example, a `$125` Weekly Fuel Fund adds another `$125` commitment each week across the chart horizon. This is linear recurring commitment, not exponential growth. Rollover separately controls how much actually unused period balance remains available in the next period; it is not required for future allocations to appear in the forecast.

Only the current rollover checkpoint is persisted for each Fund. When a period advances, that row is overwritten. Ended Fund periods are not retained as reporting history and are not included in future projections. Actual transaction detail remains live in Lunch Money.

All period boundaries use a server-stored IANA timezone. Lunch Money's v2 user response does not expose a timezone, so the browser timezone is detected on first use and then shared by every browser using that installation.

## Lunch Money API v2

The local Node service uses:

- `GET /v2/manual_accounts`
- `GET /v2/plaid_accounts`
- `GET /v2/categories?format=flattened&is_group=false`
- `GET /v2/recurring`, with a compatibility fallback to `/v2/recurring_items`
- `GET /v2/transactions?include_pending=true`

Lunch Money v2 transactions provide category IDs rather than hydrated category details. Fund Allocations store those category IDs, while category names are loaded separately for the Admin UI.

Fund types:

- **Operating** reserves a configured amount each Weekly, Monthly, Quarterly, or Yearly period. Category transactions draw down the current period. Rollover can be disabled, full, or capped.
- **Reserved** keeps an editable all-time amount set aside. Categories and a goal are optional.
- **Sinking** carries its balance forward. It can receive automatic periodic allocations, and an optional goal caps those allocations. If category spending lowers the balance, automatic allocations resume at the next period boundary until the goal is restored.

The transaction detail button lists every qualifying transaction in the current period, including the transaction that exhausts an allocation and later transactions that are over budget. Shared Fund Allocations expose this read-only detail in Household view; only Admin can exclude or re-include a transaction.

## Financial Analytics API

`GET /api/analytics/overview?accountKey=plaid:123` exposes reusable structured cash-position, recurring-attention, spending-trend, unallocated-spending, and Household Fund card data. It always calculates a six-month projection independently of the UI horizon. See [Reporting Readiness Audit](docs/reporting_readiness.md) for definitions and the metric matrix.

For automation, `GET /api/reporting/daily-highlight?accountKey=plaid:123` exposes the same calculations as a versioned, consolidated JSON report, including the complete six-month daily projection series. It requires a dedicated `REPORTING_API_TOKEN` Bearer credential and never accepts the Lunch Money API key as an automation credential. See [Reporting API](docs/reporting_api.md) for n8n configuration and the response contract.

The adapter normalizes Lunch Money's transaction signs once:

- Internal positive amount: money entering the selected account
- Internal negative amount: money leaving the selected account

Manual and Plaid IDs remain separate namespaces through compound account keys such as `manual:123` and `plaid:123`.

## Testing

```bash
npm test
npm run lint
npm run build
```

Tests cover the ledger projection, sign normalization, Fund drawdown, overspending, period anchors, rollover, account isolation, exclusions, category conflicts, available-to-spend calculations, and SQLite persistence.

## Privacy

Forecast Magic is self-hosted. Its Node server and SQLite database run on the computer or private server where the user installs it. The application does not send Fund Allocation configuration to a hosted Forecast Magic service. Financial API requests go from the self-hosted application to Lunch Money.

Do not commit `.env`, API keys, database files, or the persistent `data` directory.

## License

Distributed under the MIT License. See `LICENSE`. This fork preserves the original license and attribution for Wesley Ceraso's cashflow-app.
