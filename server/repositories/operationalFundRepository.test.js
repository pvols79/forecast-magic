import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, configureDatabase, getDatabase } from '../db/database';
import { runMigrations } from '../db/migrate';
import { OperationalFundRepository } from './operationalFundRepository';

let directory;
let databasePath;
let repository;

const fund = overrides => ({
  accountKey: 'plaid:1',
  name: 'Weekly Fuel',
  fundType: 'operating',
  allocationMode: 'scheduled',
  allocationCents: 15000,
  initialBalanceCents: 0,
  periodType: 'weekly',
  weeklyStartDay: 1,
  rolloverMode: 'none',
  householdVisible: true,
  active: true,
  categoryIds: [10],
  ...overrides,
});

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cashflow-funds-'));
  databasePath = path.join(directory, 'app.db');
  configureDatabase(databasePath);
  runMigrations();
  repository = new OperationalFundRepository();
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('OperationalFundRepository', () => {
  it('prevents active category overlap within an account and identifies the owning Fund', () => {
    repository.create(fund({ name: 'Fuel' }));
    expect(() => repository.create(fund({ name: 'Car costs' }))).toThrow(/already assigned to Fuel/);
  });

  it('allows the same category on another account and ignores disabled Funds for overlap', () => {
    repository.create(fund({ name: 'Disabled', active: false }));
    expect(repository.create(fund({ name: 'Active' })).name).toBe('Active');
    expect(repository.create(fund({ accountKey: 'manual:2', name: 'Other account' })).accountKey).toBe('manual:2');
  });

  it('persists Funds across database restart', () => {
    repository.create(fund({ name: 'Persistent Fuel' }));
    closeDatabase();
    configureDatabase(databasePath);
    runMigrations();
    repository = new OperationalFundRepository();
    expect(repository.listByAccount('plaid:1')[0].name).toBe('Persistent Fuel');
  });

  it('normalizes legacy all-time Funds as Reserved allocations', () => {
    const created = repository.create(fund({
      fundType: undefined,
      allocationMode: undefined,
      periodType: 'all-time',
      categoryIds: [],
    }));
    expect(created).toMatchObject({
      fundType: 'reserved',
      allocationMode: 'manual',
      periodType: 'all-time',
    });
  });

  it('persists Sinking allocation settings and enforces full rollover', () => {
    const created = repository.create(fund({
      fundType: 'sinking',
      allocationMode: 'scheduled',
      initialBalanceCents: 50000,
      targetCents: 100000,
      periodType: 'monthly',
      anchorDay: 1,
      rolloverMode: 'none',
    }));
    expect(created).toMatchObject({
      fundType: 'sinking',
      allocationMode: 'scheduled',
      initialBalanceCents: 50000,
      targetCents: 100000,
      rolloverMode: 'full',
    });
  });

  it('overwrites one current checkpoint instead of retaining completed-period history', () => {
    const created = repository.create(fund({}));
    repository.saveCurrentState({
      fundId: created.id, periodStart: '2026-08-10', periodEnd: '2026-08-16',
      allocationCents: 15000, carryInCents: 0, remainingCents: 2500,
      calculatedThrough: '2026-08-13',
    });
    repository.saveCurrentState({
      fundId: created.id, periodStart: '2026-08-17', periodEnd: '2026-08-23',
      allocationCents: 15000, carryInCents: 2500, remainingCents: 17500,
      calculatedThrough: '2026-08-17',
    });
    expect(repository.getCurrentState(created.id).periodStart).toBe('2026-08-17');
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM operational_fund_current_state').get().count).toBe(1);
  });
});
