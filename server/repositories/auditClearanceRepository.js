import { getDatabase } from '../db/database.js';

export class AuditClearanceRepository {
  list(accountKey) {
    return getDatabase().prepare('SELECT * FROM audit_clearances WHERE account_key = ?')
      .all(accountKey).map(row => ({
        accountKey: row.account_key, transactionId: row.transaction_id,
        reason: row.reason, verifiedAt: row.verified_at, revokedAt: row.revoked_at,
        snapshot: JSON.parse(row.snapshot_json),
      }));
  }

  save(transaction, reason) {
    getDatabase().prepare(`INSERT INTO audit_clearances
      (account_key, transaction_id, reason, verified_at, snapshot_json, revoked_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(account_key, transaction_id) DO UPDATE SET
      reason=excluded.reason, verified_at=excluded.verified_at,
      snapshot_json=excluded.snapshot_json, revoked_at=NULL`)
      .run(transaction.accountKey, transaction.transactionId, reason,
        new Date().toISOString(), JSON.stringify(transaction));
    return this.list(transaction.accountKey).find(item => item.transactionId === transaction.transactionId);
  }

  revoke(accountKey, transactionId) {
    getDatabase().prepare(`UPDATE audit_clearances SET revoked_at = ?
      WHERE account_key = ? AND transaction_id = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), accountKey, transactionId);
  }
}
