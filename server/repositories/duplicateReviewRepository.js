import { getDatabase } from '../db/database.js';

export class DuplicateReviewRepository {
  listIgnoredPairIds(accountKey) {
    return new Set(getDatabase().prepare(`
      SELECT manual_transaction_id, imported_transaction_id
      FROM duplicate_review_ignored_pairs
      WHERE account_key = ?
    `).all(accountKey).map(row => `${row.manual_transaction_id}:${row.imported_transaction_id}`));
  }

  ignore({ manualTransactionId, importedTransactionId, accountKey }) {
    if (!manualTransactionId || !importedTransactionId || !accountKey) {
      throw new Error('Manual transaction, imported transaction, and account are required.');
    }
    getDatabase().prepare(`
      INSERT INTO duplicate_review_ignored_pairs (
        manual_transaction_id, imported_transaction_id, account_key, ignored_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(manual_transaction_id, imported_transaction_id) DO UPDATE SET
        account_key = excluded.account_key,
        ignored_at = excluded.ignored_at
    `).run(
      String(manualTransactionId), String(importedTransactionId), String(accountKey),
      new Date().toISOString()
    );
    return { manualTransactionId: String(manualTransactionId), importedTransactionId: String(importedTransactionId) };
  }
}
