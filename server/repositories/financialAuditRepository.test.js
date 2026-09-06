import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, configureDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import { FinancialAuditRepository } from './financialAuditRepository.js';

let directory;
let repository;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-financial-audit-'));
  configureDatabase(path.join(directory, 'app.db'));
  runMigrations();
  repository = new FinancialAuditRepository();
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

const transaction = id => ({
  transactionId: String(id),
  source: 'plaid',
  date: '2026-09-05',
  amountCents: -4000,
  payee: 'Dutch Bros',
  originalPayee: 'DUTCH BROS',
  categoryId: 10,
  recurringId: null,
  isPending: false,
  tagIds: [],
  tagNames: [],
  notes: 'Created from Capital One Gmail alert by n8n.',
  externalId: 'n8n-capone-gmail-message-1',
  isN8n: true,
  hasPendingTag: true,
  createdAt: null,
  updatedAt: null,
  fingerprint: `fingerprint-${id}`,
});

describe('FinancialAuditRepository', () => {
  it('persists immutable audit snapshots with their findings and transactions', () => {
    const runId = repository.saveRun({
      accountKey: 'plaid:1',
      anchorDate: '2026-09-05',
      status: 'attention',
      confidenceScore: 82,
      startedAt: '2026-09-05T12:00:00.000Z',
      completedAt: '2026-09-05T12:00:01.000Z',
      sourceFreshness: { lunchMoney: { fetchedAt: 'now' } },
      summary: { health: { status: 'attention' } },
      transactions: [transaction(1)],
      findings: [{
        key: 'finding-1', severity: 'warning', category: 'balance', title: 'Difference',
        summary: 'A difference remains.', status: 'open', evidence: { cents: 100 },
      }],
    });

    expect(repository.getLatestRun('plaid:1')).toMatchObject({ id: runId, status: 'attention' });
    expect(repository.listRunTransactions(runId)).toMatchObject([{
      isN8n: true,
      hasPendingTag: true,
      externalId: 'n8n-capone-gmail-message-1',
    }]);
    expect(repository.listFindings(runId)).toMatchObject([{
      key: 'finding-1', severity: 'warning', evidence: { cents: 100 },
    }]);
  });

  it('imports the same Capital One export only once', () => {
    const statement = {
      accountKey: 'plaid:1',
      source: 'capital_one_csv',
      filename: 'capital-one.csv',
      contentSha256: 'same-content',
      coverageStart: '2026-09-01',
      coverageEnd: '2026-09-05',
      closingBalanceCents: 100000,
      importedAt: '2026-09-05T12:00:00.000Z',
      transactions: [{
        rowKey: 'row-1', date: '2026-09-05', description: 'Dutch Bros', amountCents: -4000,
        balanceAfterCents: 100000, transactionType: 'Debit',
      }],
    };

    const first = repository.saveStatementImport(statement);
    const second = repository.saveStatementImport(statement);
    expect(first.existed).toBe(false);
    expect(second).toMatchObject({ existed: true, statement: { id: first.statement.id } });
    expect(repository.listStatementTransactions(first.statement.id)).toHaveLength(1);
  });

  it('keeps matching n8n external IDs isolated by account', () => {
    const evidence = {
      externalId: 'n8n-capone-gmail-message-1',
      observedAt: '2026-09-05T12:00:00.000Z',
      date: '2026-09-05',
      payee: 'Dutch Bros',
      amountCents: -4000,
      lunchMoneyTransactionId: '100',
      tagIds: [365087],
      payload: { source: 'n8n' },
    };

    repository.upsertN8nEvidence({ ...evidence, accountKey: 'plaid:1' });
    repository.upsertN8nEvidence({
      ...evidence,
      accountKey: 'plaid:2',
      lunchMoneyTransactionId: '200',
    });

    expect(repository.listN8nEvidence('plaid:1', '2026-09-01', '2026-09-10')).toMatchObject([
      { accountKey: 'plaid:1', lunchMoneyTransactionId: '100' },
    ]);
    expect(repository.listN8nEvidence('plaid:2', '2026-09-01', '2026-09-10')).toMatchObject([
      { accountKey: 'plaid:2', lunchMoneyTransactionId: '200' },
    ]);
  });
});
