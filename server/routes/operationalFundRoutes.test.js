import { describe, expect, it } from 'vitest';
import { sanitizeProjection } from './operationalFundRoutes';

const projection = {
  currentReservedCents: 125000,
  currentFunds: [
    {
      id: 1,
      name: 'Weekly Fuel',
      remainingCents: 2500,
      householdVisible: true,
      transactions: [{
        transactionId: 10,
        accountKey: 'plaid:1',
        categoryId: 20,
        date: '2026-08-13',
        description: 'Fuel',
        amount: -50,
        type: 'actual',
        excluded: false,
        spendingCents: 5000,
        startingRemainingCents: 7500,
        coveredCents: 5000,
        overBudgetCents: 0,
        remainingAfterCents: 2500,
      }],
    },
    { id: 2, name: 'Emergency', remainingCents: 100000, householdVisible: false, transactions: [] },
  ],
  days: [{
    date: '2026-08-13',
    totalReservedCents: 125000,
    funds: [
      { id: 1, name: 'Weekly Fuel', remainingCents: 2500, householdVisible: true },
      { id: 2, name: 'Emergency', remainingCents: 100000, householdVisible: false },
    ],
    boundaryAnnotations: [
      { fundId: 1, name: 'Weekly Fuel' },
      { fundId: 2, name: 'Emergency' },
    ],
    transactionDrawdowns: [
      { fundId: 1, name: 'Weekly Fuel' },
      { fundId: 2, name: 'Emergency' },
    ],
  }],
};

describe('Operational Fund projection presentation', () => {
  it('keeps hidden Funds in Household totals while removing their details', () => {
    const household = sanitizeProjection(projection, false);

    expect(household.currentReservedCents).toBe(125000);
    expect(household.days[0].totalReservedCents).toBe(125000);
    expect(household.currentFunds.map(fund => fund.name)).toEqual(['Weekly Fuel']);
    expect(household.currentFunds[0].transactions).toHaveLength(1);
    expect(household.currentFunds[0].transactions[0]).not.toHaveProperty('accountKey');
    expect(household.currentFunds[0].transactions[0]).not.toHaveProperty('categoryId');
    expect(household.currentFunds[0].transactions[0]).toMatchObject({
      description: 'Fuel',
      spendingCents: 5000,
      coveredCents: 5000,
      remainingAfterCents: 2500,
    });
    expect(household.days[0].funds.map(fund => fund.name)).toEqual(['Weekly Fuel']);
    expect(household.days[0].boundaryAnnotations).toHaveLength(1);
    expect(household.days[0].transactionDrawdowns).toHaveLength(1);
  });

  it('leaves the complete projection available to Admin', () => {
    expect(sanitizeProjection(projection, true)).toBe(projection);
  });
});
