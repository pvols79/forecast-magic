import { AuditClearanceRepository } from '../repositories/auditClearanceRepository.js';
import { LunchMoneyService } from './lunchMoneyService.js';
import { normalizeAuditTransaction } from '../domain/financialAudit.js';

const invalid = message => Object.assign(new Error(message), { status: 400 });
export class AuditClearanceService {
  constructor(repository = new AuditClearanceRepository(), lunchMoney = new LunchMoneyService()) {
    this.repository = repository;
    this.lunchMoney = lunchMoney;
  }
  list(accountKey) {
    if (!/^(plaid|manual):[^:]+$/.test(accountKey || '')) throw invalid('A valid accountKey is required.');
    return this.repository.list(accountKey);
  }
  async clear({ accountKey, transactionId, reason, confirmedPosted }) {
    this.list(accountKey);
    if (!/^\d+$/.test(String(transactionId || '')) || confirmedPosted !== true
      || typeof reason !== 'string' || !reason.trim() || reason.length > 2000) {
      throw invalid('Transaction ID, confirmation of bank posting, and an evidence reason (up to 2000 characters) are required.');
    }
    const raw = await this.lunchMoney.getTransaction(transactionId);
    const tags = await this.lunchMoney.getTags();
    const transaction = normalizeAuditTransaction(raw, new Map(tags.map(tag => [tag.id, tag.name])));
    if (!transaction || transaction.accountKey !== accountKey) throw invalid('Transaction does not belong to this account.');
    return this.repository.save(transaction, reason.trim());
  }
  revoke(accountKey, transactionId) {
    this.list(accountKey);
    this.repository.revoke(accountKey, String(transactionId));
    return { revoked: true };
  }
}
