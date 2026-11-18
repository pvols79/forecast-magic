import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.useRealTimers();
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

it('moves money across fund families on one bank account while rejecting invalid destinations', async () => {
  const source = repository.create(fund({ name: 'Vacation', fundType: 'reserved', allocationCents: 20000, categoryIds: [], createdOn: '2026-08-01' }));
  const destination = repository.create(fund({ name: 'Christmas', fundType: 'sinking', allocationMode: 'manual', initialBalanceCents: 0, categoryIds: [], createdOn: '2026-08-01' }));
  const child = repository.create(fund({ name: 'Stockings', parentId: destination.id, fundType: 'sinking', allocationMode: 'manual', initialBalanceCents: 0, categoryIds: [], createdOn: '2026-08-01' }));
  const move = transferToId => ({ date: '2026-08-13', amountCents: -2500, note: 'Reallocate savings', transferToId });
  repository.addAdjustment(source.id, move(destination.id));
  repository.addAdjustment(source.id, move(child.id));
  const service = new OperationalFundService(repository, { getTransactions: async () => [] });
  const projection = await service.getProjection('plaid:1', '2026-08-13', '2026-08-15');
  expect(projection.currentReservedCents).toBe(20000);
  expect(projection.currentFunds.find(f => f.id === source.id).remainingCents).toBe(15000);
  expect(projection.currentFunds.find(f => f.id === destination.id).remainingCents).toBe(5000);
  const elsewhere = repository.create(fund({ accountKey: 'plaid:2', fundType: 'reserved', categoryIds: [], createdOn: '2026-08-01' }));
  expect(() => repository.addAdjustment(source.id, move(elsewhere.id))).toThrow(/same bank account/);
  expect(() => repository.addAdjustment(source.id, move(source.id))).toThrow(/same bank account/);
  repository.update(destination.id, { active: false });
  expect(() => repository.addAdjustment(source.id, move(child.id))).toThrow(/active/);
  expect(repository.getById(source.id).adjustments).toHaveLength(2);
});

it('archives a family without deleting history and restores its prior active states', async () => {
  const parent = repository.create(fund({ name: 'Wedding', fundType: 'reserved', categoryIds: [], allocationCents: 20000, createdOn: '2026-08-01' }));
  const child = repository.create(fund({ name: 'Flowers', parentId: parent.id, fundType: 'reserved', categoryIds: [12], allocationCents: 3000, createdOn: '2026-08-01' }));
  const disabled = repository.create(fund({ name: 'Disabled child', parentId: parent.id, active: false, categoryIds: [], createdOn: '2026-08-01' }));
  repository.addAdjustment(parent.id, { date: '2026-08-12', amountCents: 500, note: 'Extra saving' });
  const service = new OperationalFundService(repository, { getTransactions: async () => [
    { transactionId: 3, accountKey: 'plaid:1', categoryId: 12, date: '2026-08-12', amount: -10, type: 'actual' },
    { transactionId: 4, accountKey: 'plaid:1', categoryId: 12, date: '2026-08-15', amount: -10, type: 'actual' },
  ] });
  const before = await service.getProjection('plaid:1', '2026-08-13', '2026-08-13');
  repository.archive(parent.id, new Map([[parent.id, before.currentReservedCents], [child.id, 2000]]), '2026-08-13');
  expect(repository.getById(parent.id)).toMatchObject({ active: false, archivedRemainingCents: 22500 });
  expect(repository.getById(child.id).archivedWithParentId).toBe(parent.id);
  expect(repository.getById(parent.id).adjustments).toHaveLength(1);
  expect((await service.getProjection('plaid:1', '2026-08-16', '2026-08-16')).currentReservedCents).toBe(0);
  const history = await service.getRegister(parent.id, '2026-08-16');
  expect(history.some(row => row.transactionId === 3)).toBe(true);
  expect(history.some(row => row.transactionId === 4)).toBe(false);
  expect(() => repository.update(parent.id, { active: true })).toThrow(/Restore/);
  expect(() => repository.restore(child.id)).toThrow(/parent/);
  repository.restore(parent.id);
  expect(repository.getById(parent.id)).toMatchObject({ active: true, archivedAt: null });
  expect(repository.getById(child.id).active).toBe(true);
  expect(repository.getById(disabled.id).active).toBe(false);
});

it('keeps an archived fund archived if its category was reused', () => {
  const original = repository.create(fund({ name: 'Old holiday', categoryIds: [10] }));
  repository.archive(original.id);
  const replacement = repository.create(fund({ name: 'New holiday', categoryIds: [10] }));
  expect(() => repository.restore(original.id)).toThrow(/New holiday/);
  expect(repository.getById(original.id).archivedAt).toBeTruthy();
  expect(repository.getById(original.id).active).toBe(false);
  expect(repository.getById(replacement.id).active).toBe(true);
});

it.each([false, true])('starts a newly enabled monthly schedule at the next anchor, with adjustments=%s', async hasAdjustments => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'));
  const saved = repository.create(fund({ name: 'Birthdays', fundType: 'sinking', allocationMode: 'manual', initialBalanceCents: 10000, allocationCents: 0, createdOn: '2026-08-14', categoryIds: [20] }));
  if (hasAdjustments) repository.addAdjustment(saved.id, { date: '2026-09-05', amountCents: 2500, note: 'Birthday saving' });
  const transactions = [
    { transactionId: 'old', accountKey: 'plaid:1', categoryId: 20, date: '2026-08-05', amount: -999, type: 'actual' },
    { transactionId: 'gift', accountKey: 'plaid:1', categoryId: 20, date: '2026-10-20', amount: -40, type: 'actual' },
  ];
  const service = new OperationalFundService(repository, { getTransactions: async () => transactions });
  const before = await service.getProjection('plaid:1', '2026-11-17', '2026-11-17');
  const updated = repository.update(saved.id, { allocationMode: 'scheduled', allocationCents: 5000, periodType: 'monthly', anchorDay: 1 });
  expect(updated.scheduleStartedOn).toBe('2026-11-17');
  const after = await service.getProjection('plaid:1', '2026-11-17', '2026-12-01');
  expect(after.currentReservedCents).toBe(before.currentReservedCents);
  expect(after.currentReservedCents).toBe(hasAdjustments ? 8500 : 6000);
  expect(after.days.at(-1).totalReservedCents).toBe(after.currentReservedCents + 5000);
  expect(repository.getAllocationHistory(saved.id)).toEqual([]);
  expect((await service.getProjection('plaid:1', '2026-12-01', '2026-12-01')).currentReservedCents).toBe(after.currentReservedCents + 5000);
  expect(repository.getAllocationHistory(saved.id).map(row => row.periodStart)).toEqual(['2026-12-01']);
});

it('uses the next occurrence within this month and the installation time zone', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T02:00:00Z')); // Still Nov 17 in Chicago.
  getDatabase().prepare('INSERT INTO application_settings (key, value, updated_at) VALUES (?, ?, ?)').run('timezone', 'America/Chicago', new Date().toISOString());
  const saved = repository.create(fund({ fundType: 'sinking', allocationMode: 'manual', initialBalanceCents: 10000, categoryIds: [], createdOn: '2026-08-01' }));
  const service = new OperationalFundService(repository, { getTransactions: async () => [] });
  repository.update(saved.id, { allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 20, allocationCents: 5000 });
  expect(repository.getById(saved.id).scheduleStartedOn).toBe('2026-11-17');
  const projected = await service.getProjection('plaid:1', '2026-11-17', '2026-11-20');
  expect(projected.currentReservedCents).toBe(10000);
  expect(projected.days.at(-1).totalReservedCents).toBe(15000);
});

it('removes individual erroneous past allocations without regenerating them or changing other funding', async () => {
  const saved = repository.create(fund({ name: 'Birthdays', fundType: 'sinking', allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 1, initialBalanceCents: 10000, allocationCents: 5000, categoryIds: [], createdOn: '2026-08-01' }));
  repository.addAdjustment(saved.id, { date: '2026-08-12', amountCents: 2500, note: 'Manual addition' });
  const service = new OperationalFundService(repository, { getTransactions: async () => [] });
  const before = await service.getProjection('plaid:1', '2026-11-17', '2026-11-17');
  expect(before.currentReservedCents).toBe(27500);
  repository.removeAllocation(saved.id, '2026-09-01');
  repository.removeAllocation(saved.id, '2026-10-01');
  repository.removeAllocation(saved.id, '2026-10-01'); // Repeated removal is harmless.
  for (let index = 0; index < 2; index++) {
    expect((await service.getProjection('plaid:1', '2026-11-17', '2026-12-01')).currentReservedCents).toBe(17500);
  }
  const history = repository.getAllocationHistory(saved.id);
  expect(history.filter(row => row.removedAt)).toHaveLength(2);
  expect(history.find(row => row.periodStart === '2026-10-01').allocationCents).toBe(5000);
  expect((await service.getRegister(saved.id, '2026-11-17')).find(row => row.periodStart === '2026-10-01')).toMatchObject({ type: 'allocation', removed: true, amount: 50 });
  expect(repository.getById(saved.id).adjustments).toHaveLength(1);
  expect(() => repository.removeAllocation(saved.id, '2026-08-01')).toThrow(/opening balance/);
  repository.update(saved.id, { allocationCents: 9000 });
  const updated = await service.getProjection('plaid:1', '2026-11-17', '2026-12-01');
  expect(updated.currentReservedCents).toBe(17500); // Actual November funding stays $50.
  expect(updated.days.at(-1).totalReservedCents).toBe(26500); // Future funding uses $90.
  closeDatabase();
  configureDatabase(databasePath);
  repository.removeAllocation(saved.id, '2026-11-01');
  expect((await service.getProjection('plaid:1', '2026-11-17', '2026-11-17')).currentReservedCents).toBe(12500);
  expect(repository.getAllocationHistory(saved.id).filter(row => row.removedAt)).toHaveLength(3);
});

it('recalculates operating-fund rollover after removing a recorded allocation', async () => {
  const saved = repository.create(fund({ allocationCents: 10000, periodType: 'monthly', anchorDay: 1, rolloverMode: 'full', createdOn: '2026-08-01', categoryIds: [] }));
  const service = new OperationalFundService(repository, { getTransactions: async () => [] });
  await service.getProjection('plaid:1', '2026-08-15', '2026-08-15');
  expect((await service.getProjection('plaid:1', '2026-10-15', '2026-10-15')).currentReservedCents).toBe(30000);
  repository.removeAllocation(saved.id, '2026-09-01');
  expect((await service.getProjection('plaid:1', '2026-10-15', '2026-10-15')).currentReservedCents).toBe(20000);
});

it('can remove old allocations while disabled and re-enable only future funding', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'));
  const saved = repository.create(fund({ name: 'Birthdays', fundType: 'sinking', allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 1, initialBalanceCents: 10000, allocationCents: 5000, categoryIds: [], createdOn: '2026-08-14' }));
  repository.addAdjustment(saved.id, { date: '2026-08-20', amountCents: 2500, note: 'Manual funding' });
  const service = new OperationalFundService(repository, { getTransactions: async () => [] });
  await service.getProjection('plaid:1', '2026-11-17', '2026-11-17');
  repository.update(saved.id, { allocationMode: 'manual' });
  let register = await service.getRegister(saved.id, '2026-11-17');
  expect(register.filter(row => row.type === 'opening')).toHaveLength(1);
  expect(register.find(row => row.periodStart === '2026-08-01')?.type).toBe('opening');
  for (const date of ['2026-09-01', '2026-10-01', '2026-11-01']) repository.removeAllocation(saved.id, date);
  expect((await service.getProjection('plaid:1', '2026-11-17', '2026-11-17')).currentReservedCents).toBe(12500);
  repository.update(saved.id, { allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 1, allocationCents: 5000 });
  const reenabled = await service.getProjection('plaid:1', '2026-11-17', '2026-12-01');
  expect(reenabled.currentReservedCents).toBe(12500);
  expect(reenabled.days.at(-1).totalReservedCents).toBe(17500);
  register = await service.getRegister(saved.id, '2026-11-17');
  expect(register.filter(row => row.removed)).toHaveLength(3);
  expect(register.filter(row => row.type === 'opening')).toHaveLength(1);
});

it.each([
  { anchorDay: 1, removedDate: '2026-11-01', nextDate: '2026-12-01' },
  { anchorDay: 20, removedDate: '2026-10-20', nextDate: '2026-11-20' },
])('records new funding on anchor day $anchorDay after an older occurrence was removed', async ({ anchorDay, removedDate, nextDate }) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'));
  const saved = repository.create(fund({ name: 'Birthdays', fundType: 'sinking', allocationMode: 'scheduled', periodType: 'monthly', anchorDay, initialBalanceCents: 10000, allocationCents: 5000, categoryIds: [], createdOn: '2026-08-14' }));
  const service = new OperationalFundService(repository, { getTransactions: async () => [] });
  await service.getProjection('plaid:1', '2026-11-17', '2026-11-17');
  repository.removeAllocation(saved.id, removedDate);
  const corrected = await service.getProjection('plaid:1', '2026-11-17', '2026-11-17');
  repository.update(saved.id, { allocationMode: 'manual' });
  repository.update(saved.id, { allocationMode: 'scheduled', periodType: 'monthly', anchorDay, allocationCents: 5000 });
  closeDatabase();
  configureDatabase(databasePath);
  const scheduled = await service.getProjection('plaid:1', '2026-11-17', nextDate);
  expect(scheduled.currentReservedCents).toBe(corrected.currentReservedCents);
  expect(scheduled.days.at(-1).totalReservedCents).toBe(corrected.currentReservedCents + 5000);
  // Advance to the real boundary: funding must be saved, not just projected.
  vi.setSystemTime(new Date(`${nextDate}T18:00:00Z`));
  for (let repeat = 0; repeat < 2; repeat++) {
    const actual = await service.getProjection('plaid:1', nextDate, nextDate);
    expect(actual.currentReservedCents).toBe(corrected.currentReservedCents + 5000);
  }
  const history = repository.getAllocationHistory(saved.id);
  expect(history.find(row => row.periodStart === removedDate).removedAt).toBeTruthy();
  expect(history.filter(row => row.periodStart === nextDate)).toHaveLength(1);
  expect(history.find(row => row.periodStart === nextDate)).toMatchObject({ allocationCents: 5000, removedAt: null });
  expect((await service.getRegister(saved.id, nextDate)).find(row => row.periodStart === nextDate)).toMatchObject({ type: 'allocation', removed: false, amount: 50 });
});

it('does not apply a removal from one year to the same monthly anchor in the following year', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'));
  const saved = repository.create(fund({ fundType: 'sinking', allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 1, initialBalanceCents: 0, allocationCents: 1000, categoryIds: [], createdOn: '2026-08-01' }));
  const service = new OperationalFundService(repository, { getTransactions: async () => [] });
  await service.getProjection('plaid:1', '2026-11-17', '2026-11-17');
  repository.removeAllocation(saved.id, '2026-11-01');
  repository.update(saved.id, { allocationMode: 'manual' });
  repository.update(saved.id, { allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 1 });
  vi.setSystemTime(new Date('2027-11-01T18:00:00Z'));
  await service.getProjection('plaid:1', '2027-11-01', '2027-11-01');
  const history = repository.getAllocationHistory(saved.id);
  expect(history.find(row => row.periodStart === '2026-11-01').removedAt).toBeTruthy();
  expect(history.find(row => row.periodStart === '2027-11-01')).toMatchObject({ allocationCents: 1000, removedAt: null });
});

it.each(['reserved', 'sinking'])('includes recategorized pre-creation spending in %s balances and history when selected', async fundType => {
  const saved = repository.create(fund({ name: 'Gift budget', fundType, allocationMode: 'manual', allocationCents: 10000, initialBalanceCents: 10000, categoryIds: [20], createdOn: '2026-11-01' }));
  let transactions = [
    { transactionId: 'gift', accountKey: 'plaid:1', categoryId: 99, date: '2026-09-10', amount: -40, type: 'actual' },
    { transactionId: 'refund', accountKey: 'plaid:1', categoryId: 20, date: '2026-09-12', amount: 10, type: 'actual' },
    { transactionId: 'other-account', accountKey: 'plaid:2', categoryId: 20, date: '2026-09-10', amount: -999, type: 'actual' },
  ];
  const calls = [];
  const service = new OperationalFundService(repository, { getTransactions: async (start, end) => { calls.push(start); return transactions.filter(row => row.date >= start && row.date <= end); } });
  expect((await service.getProjection('plaid:1', '2026-11-17', '2026-11-17')).currentReservedCents).toBe(10000);
  repository.update(saved.id, { includePriorSpending: true });
  expect((await service.getProjection('plaid:1', '2026-11-17', '2026-11-17')).currentReservedCents).toBe(11000);
  // LM recategorization is visible on the next read; no copied registry is used.
  transactions = transactions.map(row => row.transactionId === 'gift' ? { ...row, categoryId: 20 } : row);
  expect((await service.getProjection('plaid:1', '2026-11-17', '2026-11-17')).currentReservedCents).toBe(7000);
  const register = await service.getRegister(saved.id, '2026-11-17');
  expect(register.filter(row => row.type === 'actual').map(row => row.transactionId).sort()).toEqual(['gift', 'refund']);
  expect(calls).toContain('1900-01-01');
  repository.addExclusion(saved.id, 'gift');
  expect((await service.getProjection('plaid:1', '2026-11-17', '2026-11-17')).currentReservedCents).toBe(11000);
  expect((await service.getRegister(saved.id, '2026-11-17')).find(row => row.transactionId === 'gift').excluded).toBe(true);
  repository.update(saved.id, { includePriorSpending: false });
  expect((await service.getProjection('plaid:1', '2026-11-17', '2026-11-17')).currentReservedCents).toBe(10000);
});

it('includes older spending without backfilling allocations when auto funding is newly enabled', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'));
  const saved = repository.create(fund({ fundType: 'sinking', allocationMode: 'manual', initialBalanceCents: 10000, categoryIds: [20], createdOn: '2026-10-01', includePriorSpending: true }));
  repository.addAdjustment(saved.id, { date: '2026-10-05', amountCents: 2000, note: 'Extra gift money' });
  const service = new OperationalFundService(repository, { getTransactions: async () => [{ transactionId: 'old-gift', accountKey: 'plaid:1', categoryId: 20, date: '2026-08-15', amount: -30, type: 'actual' }] });
  repository.update(saved.id, { allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 1, allocationCents: 5000 });
  const projected = await service.getProjection('plaid:1', '2026-11-17', '2026-12-01');
  expect(projected.currentReservedCents).toBe(9000);
  expect(projected.days.at(-1).totalReservedCents).toBe(14000);
  expect(repository.getAllocationHistory(saved.id)).toEqual([]);
  const december = await service.getProjection('plaid:1', '2026-12-01', '2026-12-01');
  expect(december.currentReservedCents).toBe(14000);
  expect((await service.getProjection('plaid:1', '2026-12-01', '2026-12-01')).currentReservedCents).toBe(14000);
  expect(repository.getAllocationHistory(saved.id).map(row => row.periodStart)).toEqual(['2026-12-01']);
});
