import { describe, expect, it, vi } from 'vitest';
import { AdminWorkflowService } from './adminWorkflowService.js';

describe('AdminWorkflowService', () => {
  it('marks selected-account deleted pending transactions as reviewed', async () => {
    const lunchMoney = {
      getAllRawTransactions: vi.fn().mockResolvedValue([
        { id: 1, plaid_account_id: 10, date: '2026-09-28', payee: 'Keep me', amount: '12.34', status: 'deleted_pending' },
        { id: 2, plaid_account_id: 11, date: '2026-09-28', payee: 'Other account', amount: '56.78', status: 'deleted_pending' },
        { id: 3, plaid_account_id: 10, date: '2026-09-28', payee: 'Reviewed', amount: '9.99', status: 'reviewed' },
      ]),
      bulkUpdateTransactions: vi.fn().mockResolvedValue([]),
    };
    const service = new AdminWorkflowService(lunchMoney);

    const result = await service.reviewDeletedPending('plaid:10');

    expect(lunchMoney.getAllRawTransactions).toHaveBeenCalledWith();
    expect(lunchMoney.bulkUpdateTransactions).toHaveBeenCalledWith([{ id: 1, status: 'reviewed' }]);
    expect(result).toMatchObject({ reviewed: 1, transactions: [{ id: 1, accountKey: 'plaid:10' }] });
  });

  it('accepts the older delete_pending spelling when Lunch Money returns it', async () => {
    const lunchMoney = {
      getAllRawTransactions: vi.fn().mockResolvedValue([
        { id: 4, manual_account_id: 20, date: '2026-09-28', payee: 'Older spelling', amount: '1.00', status: 'delete_pending' },
      ]),
      bulkUpdateTransactions: vi.fn().mockResolvedValue([]),
    };
    const service = new AdminWorkflowService(lunchMoney);

    const result = await service.reviewDeletedPending('manual:20');

    expect(lunchMoney.bulkUpdateTransactions).toHaveBeenCalledWith([{ id: 4, status: 'reviewed' }]);
    expect(result.reviewed).toBe(1);
  });

  it('previews selected-account visible recurring suggestions with linked transactions', async () => {
    const lunchMoney = {
      getSuggestedRecurringItems: vi.fn().mockResolvedValue([
        {
          id: 7,
          status: 'suggested',
          transaction_criteria: { plaid_account_id: 10, payee: 'Gym', amount: '25.00', to_base: 25 },
          matches: { found_transactions: [{ transaction_id: 100 }, { transaction_id: 101 }] },
        },
        {
          id: 8,
          status: 'suggested',
          transaction_criteria: { plaid_account_id: 10, payee: 'Linked but not found', amount: '8.00' },
          matches: { found_transactions: [] },
        },
        {
          id: 9,
          status: 'suggested',
          transaction_criteria: { plaid_account_id: 11, payee: 'Other', amount: '9.99' },
          matches: { found_transactions: [{ transaction_id: 200 }] },
        },
      ]),
      getAllRawTransactions: vi.fn().mockResolvedValue([
        { id: 100, plaid_account_id: 10, recurring_id: 7 },
        { id: 101, plaid_account_id: 10, recurring_id: 7 },
        { id: 102, plaid_account_id: 10, recurring_id: 7 },
        { id: 103, plaid_account_id: 10, recurring_id: 8 },
        { id: 200, plaid_account_id: 11, recurring_id: 9 },
      ]),
    };
    const service = new AdminWorkflowService(lunchMoney);

    const result = await service.getRecurringSuggestions('plaid:10');

    expect(lunchMoney.getSuggestedRecurringItems.mock.calls[0][0]).toMatchObject({
      start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(result).toMatchObject({
      count: 2,
      suggestions: [
        { id: 7, accountKey: 'plaid:10', transactionIds: [100, 101, 102] },
        { id: 8, accountKey: 'plaid:10', transactionIds: [103] },
      ],
    });
  });

  it('clears previewed recurring suggestion transaction links for the selected account', async () => {
    const lunchMoney = {
      getSuggestedRecurringItems: vi.fn().mockResolvedValue([
        {
          id: 7,
          status: 'suggested',
          transaction_criteria: { plaid_account_id: 10, payee: 'Gym', amount: '25.00' },
          matches: { found_transactions: [{ transaction_id: 100 }, { transaction_id: 101 }] },
        },
      ]),
      getAllRawTransactions: vi.fn().mockResolvedValue([
        { id: 100, plaid_account_id: 10, recurring_id: 7 },
        { id: 101, plaid_account_id: 10, recurring_id: 7 },
      ]),
      getTransaction: vi.fn()
        .mockResolvedValueOnce({ id: 100, recurring_id: 7, payee: 'Gym', date: '2026-08-01' })
        .mockResolvedValueOnce({ id: 101, recurring_id: 7, payee: 'Gym', date: '2026-08-15' }),
      updateTransaction: vi.fn().mockResolvedValue({}),
    };
    const service = new AdminWorkflowService(lunchMoney);

    const result = await service.clearRecurringSuggestions('plaid:10', [100, 101]);

    expect(lunchMoney.updateTransaction).toHaveBeenNthCalledWith(1, 100, { recurring_id: null });
    expect(lunchMoney.updateTransaction).toHaveBeenNthCalledWith(2, 101, { recurring_id: null });
    expect(result).toMatchObject({
      cleared: 2,
      suggestionCount: 1,
      unlinkedTransactions: [{ id: 100, recurringId: 7 }, { id: 101, recurringId: 7 }],
    });
  });

  it('rejects clearing when recurring suggestion transaction IDs changed after preview', async () => {
    const lunchMoney = {
      getSuggestedRecurringItems: vi.fn().mockResolvedValue([
        {
          id: 7,
          status: 'suggested',
          transaction_criteria: { plaid_account_id: 10, payee: 'Gym', amount: '25.00' },
          matches: { found_transactions: [{ transaction_id: 100 }] },
        },
      ]),
      getAllRawTransactions: vi.fn().mockResolvedValue([
        { id: 100, plaid_account_id: 10, recurring_id: 7 },
      ]),
      updateTransaction: vi.fn().mockResolvedValue({}),
    };
    const service = new AdminWorkflowService(lunchMoney);

    await expect(service.clearRecurringSuggestions('plaid:10', [100, 101])).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed since preview'),
    });
    expect(lunchMoney.updateTransaction).not.toHaveBeenCalled();
  });

  it('reports selected-account recurring suggestions with the Lunch Money suggested URL', async () => {
    const lunchMoney = {
      getSuggestedRecurringItems: vi.fn().mockResolvedValue([
        {
          id: 9,
          status: 'suggested',
          transaction_criteria: { plaid_account_id: 10, payee: 'Insurance', amount: '80.00' },
        },
        {
          id: 10,
          status: 'suggested',
          transaction_criteria: { plaid_account_id: 11, payee: 'Other', amount: '20.00' },
        },
      ]),
      getAllRawTransactions: vi.fn().mockResolvedValue([
        { id: 9, plaid_account_id: 10, recurring_id: null },
      ]),
    };
    const service = new AdminWorkflowService(lunchMoney);

    const result = await service.getRecurringSuggestions('plaid:10');

    expect(result).toMatchObject({
      count: 0,
      suggestions: [],
    });
  });
});
