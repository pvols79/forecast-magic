import { describe, expect, it } from 'vitest';
import { calculateCurrentFundState, projectOperationalFunds } from './operationalFunds';

const makeFund = overrides => ({
  id: 1,
  accountKey: 'plaid:1',
  name: 'Weekly Fuel',
  fundType: 'operating',
  allocationMode: 'scheduled',
  allocationCents: 15000,
  initialBalanceCents: 0,
  periodType: 'weekly',
  weeklyStartDay: 1,
  anchorMonth: null,
  anchorDay: null,
  rolloverMode: 'none',
  rolloverCapCents: null,
  targetCents: null,
  householdVisible: true,
  active: true,
  createdAt: '2026-08-10T12:00:00.000Z',
  categoryIds: [10],
  excludedTransactionIds: [],
  ...overrides,
});

const transaction = overrides => ({
  transactionId: 1,
  accountKey: 'plaid:1',
  categoryId: 10,
  date: '2026-08-12',
  description: 'Fuel purchase',
  amount: -50,
  type: 'actual',
  ...overrides,
});

const project = (funds, transactions = [], checkpoints = new Map(), endDate = '2026-08-31') =>
  projectOperationalFunds({ funds, transactions, checkpoints, anchorDate: '2026-08-13', endDate });

describe('Operational Fund engine', () => {
  it('reserves basic periodic and all-time Funds', () => {
    const result = project([
      makeFund({ id: 1 }),
      makeFund({ id: 2, name: 'Emergency', allocationCents: 100000, periodType: 'all-time', categoryIds: [] }),
    ]);
    expect(result.currentReservedCents).toBe(115000);
  });

  it('draws one Fund down from multiple mapped categories only', () => {
    const fund = makeFund({ categoryIds: [10, 11] });
    const state = calculateCurrentFundState(fund, null, [
      transaction({ transactionId: 1, categoryId: 10, amount: -40 }),
      transaction({ transactionId: 2, categoryId: 11, amount: -35 }),
      transaction({ transactionId: 3, categoryId: 12, amount: -90 }),
    ], '2026-08-13');
    expect(state.remainingCents).toBe(7500);
  });

  it('keeps all qualifying transactions visible after the Fund reaches zero', () => {
    const state = calculateCurrentFundState(makeFund({ allocationCents: 5000 }), null, [
      transaction({ transactionId: 1, amount: -50 }),
      transaction({ transactionId: 2, amount: -30 }),
    ], '2026-08-13');
    expect(state.remainingCents).toBe(0);
    expect(state.periodTransactions).toHaveLength(2);
  });

  it('shows the transaction that exhausts a Fund and later overspending transactions', () => {
    const state = calculateCurrentFundState(makeFund({ allocationCents: 12500 }), null, [
      transaction({ transactionId: 1, date: '2026-08-10', amount: -60 }),
      transaction({ transactionId: 2, date: '2026-08-11', amount: -80 }),
      transaction({ transactionId: 3, date: '2026-08-12', amount: -25 }),
    ], '2026-08-13');

    expect(state.periodTransactions.map(item => ({
      coveredCents: item.coveredCents,
      overBudgetCents: item.overBudgetCents,
      remainingAfterCents: item.remainingAfterCents,
    }))).toEqual([
      { coveredCents: 6000, overBudgetCents: 0, remainingAfterCents: 6500 },
      { coveredCents: 6500, overBudgetCents: 1500, remainingAfterCents: 0 },
      { coveredCents: 0, overBudgetCents: 2500, remainingAfterCents: 0 },
    ]);
  });

  it('excludes a transaction from drawdown without removing it from the live transaction view', () => {
    const state = calculateCurrentFundState(makeFund({ excludedTransactionIds: ['1'] }), null, [transaction({})], '2026-08-13');
    expect(state.remainingCents).toBe(15000);
    expect(state.periodTransactions[0].excluded).toBe(true);
  });

  it('never allows overspending to make the Fund negative or reduce the next allocation', () => {
    const result = project(
      [makeFund({ rolloverMode: 'full' })],
      [transaction({ amount: -200 })],
      new Map(),
      '2026-08-18'
    );
    expect(result.currentFunds[0].remainingCents).toBe(0);
    expect(result.days.find(day => day.date === '2026-08-17').totalReservedCents).toBe(15000);
  });

  it('does not draw down from another account transaction', () => {
    const result = project([makeFund({})], [transaction({ accountKey: 'manual:2', amount: -150 })]);
    expect(result.currentReservedCents).toBe(15000);
  });

  it('does not reserve Funds belonging to another selected account', () => {
    const result = projectOperationalFunds({
      funds: [
        makeFund({ id: 1, accountKey: 'plaid:1' }),
        makeFund({ id: 2, accountKey: 'manual:2', allocationCents: 90000 }),
      ],
      accountKey: 'plaid:1',
      transactions: [],
      anchorDate: '2026-08-13',
      endDate: '2026-08-13',
    });
    expect(result.currentReservedCents).toBe(15000);
    expect(result.currentFunds.map(fund => fund.id)).toEqual([1]);
  });

  it('does not reset an all-time Fund', () => {
    const result = project([makeFund({ periodType: 'all-time', categoryIds: [] })], [], new Map(), '2027-08-13');
    expect(result.days.at(-1).totalReservedCents).toBe(15000);
    expect(result.days.every(day => day.boundaryAnnotations.length === 0)).toBe(true);
  });

  it('applies allocation changes to the current period', () => {
    const changedFund = makeFund({ allocationCents: 20000 });
    const checkpoint = new Map([[1, {
      fundId: 1, periodStart: '2026-08-10', periodEnd: '2026-08-16',
      allocationCents: 15000, carryInCents: 0, remainingCents: 10000,
      calculatedThrough: '2026-08-12',
    }]]);
    const result = project([changedFund], [transaction({ amount: -50 })], checkpoint);
    expect(result.currentReservedCents).toBe(15000);
    expect(result.days.find(day => day.date === '2026-08-17').boundaryAnnotations[0].allocationCents).toBe(20000);
  });

  it.each([
    ['none', null, 0],
    ['full', null, 6000],
    ['capped', 2500, 2500],
  ])('calculates %s rollover separately from the flat future commitment', (mode, cap, expectedCarry) => {
    const result = project([
      makeFund({ rolloverMode: mode, rolloverCapCents: cap }),
    ], [transaction({ amount: -90 })], new Map(), '2026-08-18');
    const annotation = result.days.find(day => day.date === '2026-08-17').boundaryAnnotations[0];
    expect(annotation.previousRemainingCents).toBe(6000);
    expect(annotation.carryInCents).toBe(expectedCarry);
    expect(annotation.reservedDeltaCents).toBe(15000);
  });

  it('adds one flat allocation to the projection at every future period boundary without requiring rollover', () => {
    const result = project([makeFund({ rolloverMode: 'none' })], [transaction({ amount: -90 })], new Map(), '2026-08-31');

    expect(result.currentReservedCents).toBe(6000);
    expect(result.days.find(day => day.date === '2026-08-17').totalReservedCents).toBe(21000);
    expect(result.days.find(day => day.date === '2026-08-24').totalReservedCents).toBe(36000);
    expect(result.days.find(day => day.date === '2026-08-31').totalReservedCents).toBe(51000);
    expect(result.days.find(day => day.date === '2026-08-24').funds[0]).toMatchObject({
      remainingCents: 15000,
      projectedReserveCents: 36000,
    });
  });

  it('projects every future Fund period across the selected horizon', () => {
    const result = project([makeFund({})], [], new Map(), '2026-09-01');
    const boundaries = result.days.filter(day => day.boundaryAnnotations.length > 0);
    expect(boundaries.map(day => day.date)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31']);
  });

  it('keeps targets informational only', () => {
    const withoutTarget = project([makeFund({ targetCents: null })]);
    const withTarget = project([makeFund({ targetCents: 100000 })]);
    expect(withTarget.currentReservedCents).toBe(withoutTarget.currentReservedCents);
  });

  it('caps automatic Sinking contributions at the goal and resumes after drawdown', () => {
    const sinking = makeFund({
      fundType: 'sinking',
      allocationMode: 'scheduled',
      allocationCents: 20000,
      initialBalanceCents: 90000,
      targetCents: 100000,
      rolloverMode: 'full',
    });
    const result = project([sinking], [
      transaction({ transactionId: 4, date: '2026-08-18', amount: -300, type: 'future' }),
    ], new Map(), '2026-08-31');

    expect(result.currentReservedCents).toBe(90000);
    expect(result.days.find(day => day.date === '2026-08-17').boundaryAnnotations[0].reservedDeltaCents).toBe(10000);
    expect(result.days.find(day => day.date === '2026-08-24').boundaryAnnotations[0].reservedDeltaCents).toBe(20000);
    expect(result.days.find(day => day.date === '2026-08-31').boundaryAnnotations[0].reservedDeltaCents).toBe(10000);
    expect(result.days.at(-1).funds[0].remainingCents).toBe(100000);
  });

  it('keeps a manual Sinking balance without creating future allocations', () => {
    const sinking = makeFund({
      fundType: 'sinking',
      allocationMode: 'manual',
      allocationCents: 0,
      initialBalanceCents: 75000,
      periodType: 'all-time',
      categoryIds: [],
    });
    const result = project([sinking], [], new Map(), '2027-08-13');
    expect(result.currentReservedCents).toBe(75000);
    expect(result.days.every(day => day.boundaryAnnotations.length === 0)).toBe(true);
  });

  it('draws down a real pending or future-dated transaction on its projected date', () => {
    const result = project([makeFund({})], [
      transaction({ date: '2026-08-14', amount: -50, type: 'pending' }),
    ], new Map(), '2026-08-15');
    expect(result.days.find(day => day.date === '2026-08-13').totalReservedCents).toBe(15000);
    expect(result.days.find(day => day.date === '2026-08-14').totalReservedCents).toBe(10000);
  });

  it('provides drawdown-aware tooltip state and boundary details', () => {
    const result = project([makeFund({ rolloverMode: 'full' })], [transaction({ amount: -125 })], new Map(), '2026-08-18');
    expect(result.days[0].funds[0].remainingCents).toBe(2500);
    expect(result.days.find(day => day.date === '2026-08-17').boundaryAnnotations[0]).toMatchObject({
      allocationCents: 15000,
      carryInCents: 2500,
      resultingRemainingCents: 17500,
      reservedDeltaCents: 15000,
      projectedReserveCents: 17500,
    });
  });
});
