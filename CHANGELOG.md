# Changelog

## Unreleased

- Treat API- and manually created transactions on Plaid accounts as opening adjustments until Duplicate Review replaces them with their imported transaction.
- Preserve unresolved manual/imported duplicates in the projection so data issues remain visible for review.

## 0.1.1 - Docker Runtime Fix

- Included the shared projection modules required by the reporting service in the production container image.

## 0.1.0 - Initial Forecast Magic Preview

- Migrated the Lunch Money integration from API v1 to API v2.
- Added normalized account and cash-flow event boundaries.
- Included actual, pending, future-dated, recurring, and missed recurring activity.
- Added Fund Allocations with Operating, Reserved, and Sinking types.
- Added Household and Admin presentations backed by persistent SQLite configuration.
- Added reusable financial analytics and a token-protected Daily Highlight API.
- Added standalone and shared-NGINX Docker deployment packages.
- Rebranded the independent application as Forecast Magic.
