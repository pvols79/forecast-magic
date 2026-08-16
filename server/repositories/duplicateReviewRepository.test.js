import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, configureDatabase, getDatabase } from '../db/database';
import { runMigrations } from '../db/migrate';
import { DuplicateReviewRepository } from './duplicateReviewRepository';

let directory;
let repository;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-duplicate-review-'));
  configureDatabase(path.join(directory, 'app.db'));
  runMigrations();
  repository = new DuplicateReviewRepository();
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('DuplicateReviewRepository', () => {
  it('persists an exact ignored pair without suppressing similar pairs', () => {
    repository.ignore({ manualTransactionId: 1, importedTransactionId: 2, accountKey: 'plaid:1' });
    const ignored = repository.listIgnoredPairIds('plaid:1');
    expect(ignored.has('1:2')).toBe(true);
    expect(ignored.has('1:3')).toBe(false);
    expect(repository.listIgnoredPairIds('plaid:2').size).toBe(0);
  });

  it('updates the timestamp without creating duplicate ignore rows', () => {
    const pair = { manualTransactionId: 1, importedTransactionId: 2, accountKey: 'plaid:1' };
    repository.ignore(pair);
    repository.ignore(pair);
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM duplicate_review_ignored_pairs').get().count).toBe(1);
  });
});
