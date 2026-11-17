import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { getDateInTimezone } from '../domain/periods.js';
import { OperationalFundRepository } from '../repositories/operationalFundRepository.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { OperationalFundService } from '../services/operationalFundService.js';

export const sanitizeProjection = (projection, isAdmin) => {
  if (isAdmin) return projection;
  const sharedTransaction = transaction => ({
    transactionId: transaction.transactionId,
    date: transaction.date,
    description: transaction.description,
    amount: transaction.amount,
    type: transaction.type,
    excluded: transaction.excluded,
    spendingCents: transaction.spendingCents,
    refundCents: transaction.refundCents,
    restoredCents: transaction.restoredCents,
    startingRemainingCents: transaction.startingRemainingCents,
    coveredCents: transaction.coveredCents,
    overBudgetCents: transaction.overBudgetCents,
    remainingAfterCents: transaction.remainingAfterCents,
  });
  const sharedFund = fund => ({
    ...fund,
    children: undefined,
    adjustments: undefined,
    transactions: (fund.transactions || []).filter(transaction => transaction.type !== 'adjustment' && (!transaction.fundId || transaction.fundId === fund.id || fund.children?.find(child => child.id === transaction.fundId)?.householdVisible)).map(sharedTransaction),
  });
  return {
    ...projection,
    currentFunds: projection.currentFunds
      .filter(fund => fund.householdVisible)
      .map(sharedFund),
    days: projection.days.map(day => ({
      ...day,
      funds: day.funds.filter(fund => fund.householdVisible).map(fund => ({ ...fund, children: undefined })),
      boundaryAnnotations: day.boundaryAnnotations.filter(annotation => {
        const fund = projection.currentFunds.find(candidate => candidate.id === annotation.fundId);
        return fund?.householdVisible;
      }),
      transactionDrawdowns: day.transactionDrawdowns.filter(drawdown => {
        const fund = projection.currentFunds.find(candidate => candidate.id === drawdown.fundId);
        return fund?.householdVisible;
      }),
    })),
  };
};

export const createOperationalFundRouter = (
  repository = new OperationalFundRepository(),
  service = new OperationalFundService(repository),
  settings = new SettingsRepository()
) => {
  const router = Router();

  router.get('/projection', async (request, response) => {
    const projection = await service.getProjection(
      request.query.accountKey,
      request.query.anchorDate,
      request.query.endDate
    );
    response.json(sanitizeProjection(projection, request.isAdmin && request.query.view !== 'household'));
  });

  router.get('/', requireAdmin, (request, response) => response.json({
    funds: repository.listByAccount(request.query.accountKey),
  }));

  router.get('/:id/register', requireAdmin, async (request, response) => {
    const today = getDateInTimezone(new Date(), settings.get('timezone') || 'UTC');
    const rows = await service.getRegister(Number(request.params.id), today);
    if (!rows) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.json({ rows });
  });

  router.get('/:id', requireAdmin, (request, response) => {
    const fund = repository.getById(Number(request.params.id));
    if (!fund) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.json({ fund });
  });

  router.post('/', requireAdmin, (request, response) => {
    const timezone = settings.get('timezone') || 'UTC';
    const fund = repository.create({
      ...request.body,
      createdOn: getDateInTimezone(new Date(), timezone),
    });
    response.status(201).json({ fund });
  });

  router.put('/:id', requireAdmin, (request, response) => {
    const fund = repository.update(Number(request.params.id), request.body);
    if (!fund) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.json({ fund });
  });

  router.post('/:id/archive', requireAdmin, async (request, response) => {
    const id = Number(request.params.id);
    const existing = repository.getById(id);
    if (!existing) return response.status(404).json({ error: 'Fund Allocation not found.' });
    const today = getDateInTimezone(new Date(), settings.get('timezone') || 'UTC');
    const projection = await service.getProjection(existing.accountKey, today, today);
    const balances = new Map(projection.currentFunds.flatMap(fund => [fund, ...(fund.children || [])]).map(fund => [fund.id, fund.remainingCents]));
    return response.json({ fund: repository.archive(id, balances, today) });
  });

  router.post('/:id/restore', requireAdmin, (request, response) => {
    const fund = repository.restore(Number(request.params.id));
    if (!fund) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.json({ fund });
  });

  router.delete('/:id', requireAdmin, (request, response) => {
    if (!repository.delete(Number(request.params.id))) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.status(204).end();
  });

  router.post('/:id/adjustments', requireAdmin, async (request, response) => {
    const id = Number(request.params.id);
    const existing = repository.getById(id);
    if (!existing) return response.status(404).json({ error: 'Fund Allocation not found.' });
    const today = getDateInTimezone(new Date(), settings.get('timezone') || 'UTC');
    const input = { ...request.body, date: today };
    if (input.amountCents < 0) {
      const projection = await service.getProjection(existing.accountKey, today, today);
      const state = projection.currentFunds.flatMap(fund => [fund, ...(fund.children || [])]).find(fund => fund.id === id);
      const available = state?.ownRemainingCents ?? state?.remainingCents ?? 0;
      if (-input.amountCents > available) return response.status(400).json({ error: 'The withdrawal exceeds the available Fund balance.' });
    }
    const fund = repository.addAdjustment(id, input);
    if (!fund) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.status(201).json({ fund });
  });

  router.delete('/:id/allocations/:periodStart', requireAdmin, (request, response) => {
    const fund = repository.removeAllocation(Number(request.params.id), request.params.periodStart);
    if (!fund) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.json({ fund });
  });

  router.post('/:id/exclusions', requireAdmin, (request, response) => {
    const fund = repository.addExclusion(Number(request.params.id), request.body?.transactionId);
    if (!fund) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.json({ fund });
  });

  router.delete('/:id/exclusions/:transactionId', requireAdmin, (request, response) => {
    const fund = repository.removeExclusion(Number(request.params.id), request.params.transactionId);
    if (!fund) return response.status(404).json({ error: 'Fund Allocation not found.' });
    return response.json({ fund });
  });

  return router;
};
