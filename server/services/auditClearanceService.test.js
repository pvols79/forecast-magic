import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { configureDatabase, closeDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import { AuditClearanceRepository } from '../repositories/auditClearanceRepository.js';
import { AuditClearanceService } from './auditClearanceService.js';
import { applyAuditClearance } from '../domain/auditClearance.js';
import { normalizeAuditTransaction, findStalePendingTransactions, buildBalanceBridge } from '../domain/financialAudit.js';

let directory;
const raw = { id: 42, plaid_account_id: 1, amount: '40', date: '2026-09-01', source: 'api', is_pending: true, tags: [{ id: 1, name: 'n8n_proc' }] };
const repository = new AuditClearanceRepository();
const service = new AuditClearanceService(repository, {
  getTransaction: async () => raw, getTags: async () => [{ id: 1, name: 'n8n_proc' }],
});
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clearance-'));
  configureDatabase(path.join(directory, 'app.db'));
  runMigrations();
});
afterEach(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });

it('persists verified settlement, excludes stale pending, preserves originals and supports undo', async () => {
  const input = { accountKey: 'plaid:1', transactionId: '42', confirmedPosted: true, reason: 'Matched bank CSV row 3, only register representation.' };
  const normalized = normalizeAuditTransaction(raw);
  expect(findStalePendingTransactions([normalized], '2026-10-10')).toHaveLength(1);
  await service.clear(input);
  closeDatabase();
  const entries = service.list('plaid:1');
  const cleared = applyAuditClearance(normalized, entries);
  expect(cleared).toMatchObject({ effectiveStatus: 'cleared', isPending: false, lmIsPending: true });
  expect(cleared.tagNames).toEqual(normalized.tagNames);
  expect(findStalePendingTransactions([cleared], '2026-10-10')).toEqual([]);
  expect(buildBalanceBridge({ lunchMoneyBalanceCents: 10000, transactions: [cleared] }).expectedAvailableCents).toBe(10000);
  expect(applyAuditClearance({ ...normalized, amountCents: -5000 }, entries)).toMatchObject({ effectiveStatus: 'pending', clearanceNeedsReview: true });
  expect(applyAuditClearance({ ...normalized, accountKey: 'plaid:2' }, entries).effectiveStatus).toBe('pending');
  service.revoke('plaid:1', '42');
  expect(applyAuditClearance(normalized, service.list('plaid:1')).effectiveStatus).toBe('pending');
});

it('requires explicit evidence confirmation and a transaction in the correct account', async () => {
  await expect(service.clear({ accountKey: 'plaid:1', transactionId: 42 })).rejects.toMatchObject({ status: 400 });
  await expect(service.clear({ accountKey: 'plaid:2', transactionId: 42, confirmedPosted: true, reason: 'verified' })).rejects.toMatchObject({ status: 400 });
});
