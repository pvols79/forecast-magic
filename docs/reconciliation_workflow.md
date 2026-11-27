# Evidence-backed reconciliation

In **Admin Workflow → Reconciliation**, select the bank account, upload evidence, review the extracted rows, and choose **Reconcile now**. This workflow reads Lunch Money and saves its own evidence and reports. It never creates, edits, deletes, merges, or retags Lunch Money transactions.

## Evidence

- **Capital One posted CSV** is the authoritative posted bank register. Confirm the account and export coverage dates, including empty days at either end. The initial suggested dates come from the rows, not proof of complete export coverage.
- **Venmo supporting CSV** explains counterparties for bank Venmo transactions. Include only rows funded by or transferred to the selected bank account and confirm that choice. Venmo-balance and other-account activity should be excluded with reasons. These rows never add another copy to posted bank totals.
- **Pending screenshot** accepts PNG or JPEG. Text extraction runs locally using Tesseract, included in the production Docker image. Compare all extracted rows with the original image, correct amounts/dates, and add any charges extraction missed. Missing years and relative dates are deliberately not guessed. If extraction is unavailable, enter the pending rows manually. Confirm explicitly if the image contains no relevant charges.

Positive amounts are inflows; negative amounts are outflows. Every uploaded document must be reviewed, including documents excluded with a reason. Keep original rows and explain exclusions instead of deleting rows. Excluding a real posted bank transaction makes completeness limited rather than declaring a full reconciliation.

Limits are 10 MB per file, 25 files/100 MB per session, and 10,000 extracted rows per CSV. This initial workflow reconciles USD activity for one selected account. PDFs and spreadsheet workbooks are not accepted; use CSV exports or PNG/JPEG screenshots.

## Matching and results

Each run fetches fresh Lunch Money transactions across all pages, including pending records and five days of date padding around the bank coverage. Split parents represent the original bank amount once; group parents are omitted while underlying transactions are reconciled individually. Existing verified clearance decisions are honored and shown in the report.

Matching requires the same signed amount, a nearby date, and merchant evidence (or verified Venmo counterparty evidence). Cleared imports are matched before pending placeholders. Equal amounts alone do not establish a match. Ambiguous candidates stay unresolved. You may explicitly confirm a same-amount match with a reason and rerun; this only changes the reconciliation decision.

Repeated identical purchases within a file remain distinct. Overlapping exports retain the greatest observed multiplicity rather than collapsing legitimate purchases. Each bank row and LM accounting record receives a disposition. Debit and credit counts and cent totals are checked separately in both directions, so missing income cannot cancel an extra expense.

The result distinguishes:

- Bank-posted activity missing in LM.
- Additional cleared LM activity within bank coverage.
- Ambiguous matches and incomplete evidence.
- Potential duplicate placeholders alongside imported transactions.
- Aging pending placeholders and possible authorization/settlement amount differences.
- Pending screenshot charges missing from LM, possibly settled, or ambiguous.
- Unmatched records near coverage boundaries and recurring projections, which are not automatically treated as extra posted transactions.

Every concern includes its relevant file/row and LM transaction identifiers, source, and effective status. Pending concerns can remain even when the **posted transaction register** reconciles in both directions. That verdict does not prove that every pending authorization is resolved, nor is it a same-date bank-balance bridge. The current LM synced balance is context only.

## Saved evidence and runs

Original files, extracted text, reviewed rows, document hashes, exclusions, and immutable run results persist in the installation's SQLite database on the Docker data volume. Treat backups of that volume as containing financial documents. Originals are available only through admin-authenticated routes and are retained unchanged.

The latest session for each account loads automatically. **New reconciliation** starts another session; previous evidence and reports remain stored. **Download report** exports the current run as JSON. Changing evidence or match decisions marks the previous result stale. Changes in LM require another run to fetch a fresh snapshot; saved runs are historical observations.

## Verification

Automated domain/service tests cover directional totals, overlapping exports, repeated identical purchases, ambiguous/manual matches, Venmo supporting evidence, pending holds, screenshot review fallback, admin authorization, split/group handling, clearance records, immutable results, and concurrent evidence edits. The full test suite and production build pass. Browser verification used fictional data and confirmed evidence review, execution, totals, and findings. Browser file-picker upload was blocked by the local Chrome extension's file access permission; the upload service was tested separately. Native Tesseract execution and a Docker image build were not available in the development environment.
