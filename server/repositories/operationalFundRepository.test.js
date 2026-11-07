import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, configureDatabase, getDatabase } from '../db/database';
import { runMigrations } from '../db/migrate';
import { OperationalFundRepository } from './operationalFundRepository';
import { OperationalFundService } from '../services/operationalFundService';

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
  it('retains scheduled allocation history across skipped periods, repeated reads and restart only', async () => {
    const scheduled = repository.create(fund({ categoryIds: [] }));
    const sinking = repository.create(fund({
      name: 'Sinking', fundType: 'sinking', initialBalanceCents: 90000,
      allocationCents: 20000, targetCents: 100000, categoryIds: [],
    }));
    const manual = repository.create(fund({
      name: 'Manual', fundType: 'sinking', allocationMode: 'manual', categoryIds: [],
    }));
    const reserved = repository.create(fund({
      name: 'Reserved', fundType: 'reserved', categoryIds: [],
    }));
    const service = new OperationalFundService(repository, { getTransactions: async () => [] });
    await service.getProjection('plaid:1', '2026-08-13', '2026-09-30');
    await service.getProjection('plaid:1', '2026-08-31', '2026-09-30');
    await service.getProjection('plaid:1', '2026-08-31', '2026-09-30');
    expect(repository.getAllocationHistory(scheduled.id).map(period => period.periodStart))
      .toEqual(['2026-08-31', '2026-08-24', '2026-08-17', '2026-08-10']);
    expect(repository.getAllocationHistory(sinking.id).map(period => period.allocationCents))
      .toEqual([0, 0, 10000, 90000]);
    repository.saveAllocationHistory(manual.id, repository.getAllocationHistory(scheduled.id));
    repository.saveAllocationHistory(reserved.id, repository.getAllocationHistory(scheduled.id));
    expect(repository.getAllocationHistory(manual.id)).toEqual([]);
    expect(repository.getAllocationHistory(reserved.id)).toEqual([]);
    closeDatabase();
    configureDatabase(databasePath);
    expect(repository.getAllocationHistory(scheduled.id)).toHaveLength(4);
    repository.delete(scheduled.id);
    expect(repository.getAllocationHistory(scheduled.id)).toEqual([]);
  });

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

describe('Fund workspace', () => {
  it('rolls up child balances once and keeps moves as balanced register entries', async () => {
    const parent = repository.create(fund({ name: 'Birthdays', fundType: 'reserved', allocationCents: 25000, categoryIds: [], createdOn: '2026-08-01' }));
    const child = repository.create(fund({ name: 'Alex', parentId: parent.id, fundType: 'sinking', allocationMode: 'manual', initialBalanceCents: 0, categoryIds: [11], createdOn: '2026-08-01', occasionDate: '2026-08-20' }));
    repository.addAdjustment(parent.id, { date: '2026-08-10', amountCents: -10000, note: 'Birthday envelope', transferToId: child.id });
    const service = new OperationalFundService(repository, { getTransactions: async () => [{ transactionId: 1, date: '2026-08-12', accountKey: 'plaid:1', categoryId: 11, amount: -40, type: 'actual', description: 'Gift' }, { transactionId: 2, date: '2026-08-14', accountKey: 'plaid:1', categoryId: 11, amount: -20, type: 'future', description: 'Upcoming gift' }] });
    const projection = await service.getProjection('plaid:1', '2026-08-13', '2026-08-15');
    expect(projection.currentFunds).toHaveLength(1);
    expect(projection.currentReservedCents).toBe(21000);
    expect(projection.currentFunds[0]).toMatchObject({ ownRemainingCents: 15000, remainingCents: 21000 });
    expect(projection.currentFunds[0].children[0].remainingCents).toBe(6000);
    expect(projection.days[2].totalReservedCents).toBe(19000);
    expect(projection.days[1].transactionDrawdowns[0].fundId).toBe(parent.id);
    expect(projection.days[2].funds).toHaveLength(1);
    const rows = await service.getRegister(parent.id, '2026-08-13');
    expect(rows.filter(row => row.type === 'adjustment').reduce((sum, row) => sum + row.amount, 0)).toBe(0);
    expect(rows.find(row => row.transactionId === 1).fundId).toBe(child.id);
    expect(repository.getById(parent.id).allocationCents).toBe(25000);
    expect(() => repository.delete(parent.id)).toThrow(/sub-funds/);
    expect(() => repository.create(fund({ parentId: child.id, categoryIds: [] }))).toThrow(/top-level/);
    expect(() => repository.create(fund({ accountKey: 'plaid:2', parentId: parent.id, categoryIds: [] }))).toThrow(/same account/);
    repository.update(parent.id, { active: false });
    expect((await service.getProjection('plaid:1', '2026-08-13', '2026-08-15')).currentReservedCents).toBe(0);
  });

  it('replays dated adjustments across scheduled periods and survives repeated projections', async () => {
    const saved = repository.create(fund({ fundType: 'sinking', initialBalanceCents: 10000, allocationCents: 1000, createdOn: '2026-08-10', categoryIds: [] }));
    repository.addAdjustment(saved.id, { date: '2026-08-12', amountCents: 2500, note: 'Extra saving' });
    const service = new OperationalFundService(repository, { getTransactions: async () => [] });
    const first = await service.getProjection('plaid:1', '2026-08-25', '2026-08-31');
    const second = await service.getProjection('plaid:1', '2026-08-25', '2026-08-31');
    expect(first.currentReservedCents).toBe(14500);
    expect(second.currentReservedCents).toBe(14500);
    expect(first.days.at(-1).totalReservedCents).toBe(15500);
    expect(repository.getById(saved.id).initialBalanceCents).toBe(10000);
    expect(() => repository.addAdjustment(saved.id, { date: '2026-02-30', amountCents: 100, note: 'Bad date' })).toThrow(/valid/);
    expect(() => repository.addAdjustment(saved.id, { date: '2026-08-12', amountCents: 0, note: 'Zero' })).toThrow(/nonzero/);
  });
});
