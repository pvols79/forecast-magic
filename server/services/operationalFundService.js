import { getPeriodForDate } from '../domain/periods.js';
import { getFundSpendingStart, isOpeningFundAllocation, projectOperationalFunds, rollUpFundProjection } from '../domain/operationalFunds.js';
import { OperationalFundRepository } from '../repositories/operationalFundRepository.js';
import { LunchMoneyService } from './lunchMoneyService.js';
import { matchesFundSelectors } from '../domain/fundMatching.js';

const earliest = dates => dates.reduce((minimum, date) => !minimum || date < minimum ? date : minimum, null);

export class OperationalFundService {
  constructor(
    repository = new OperationalFundRepository(),
    lunchMoneyService = new LunchMoneyService()
  ) {
    this.repository = repository;
    this.lunchMoneyService = lunchMoneyService;
  }

  getAllocationHistory(accountKey, throughDate) {
    const funds = this.repository.listByAccount(accountKey);
    return funds.flatMap(fund => this.repository.getAllocationHistory(fund.id)
      .filter(entry => entry.periodStart <= (fund.archivedOn || throughDate)
        && entry.periodStart <= throughDate && !isOpeningFundAllocation(fund, entry))
      .map(entry => ({
        fundId: fund.id, fundName: fund.name,
        parentName: funds.find(parent => parent.id === fund.parentId)?.name || null,
        date: entry.periodStart, periodStart: entry.periodStart,
        amount: entry.allocationCents / 100, removed: Boolean(entry.removedAt),
        archived: Boolean(fund.archivedAt),
      })))
      .sort((a, b) => b.date.localeCompare(a.date) || b.fundId - a.fundId);
  }

  async getRegister(id, throughDate) {
    const fund = this.repository.getById(id);
    if (!fund) return null;
    const funds = [fund, ...this.repository.listByAccount(fund.accountKey).filter(child => child.parentId === fund.id)];
    const start = earliest(funds.map(getFundSpendingStart));
    const transactions = await this.lunchMoneyService.getTransactions(start, throughDate, throughDate);
    return funds.flatMap(item => {
      const history = this.repository.getAllocationHistory(item.id);
      const isOpening = entry => isOpeningFundAllocation(item, entry);
      const hasRecordedOpening = history.some(isOpening);
      const cutoff = item.archivedOn || throughDate;
      return [
        { transactionId: `opening:${item.id}`, fundId: item.id, subFundName: item.name,
          date: item.createdOn, type: 'opening', description: 'Opening balance',
          amount: (hasRecordedOpening || (item.allocationMode === 'scheduled' && !item.scheduleStartedOn) ? 0
            : item.fundType === 'sinking' ? item.initialBalanceCents
              : item.fundType === 'reserved' ? item.allocationCents : 0) / 100 },
        ...(item.adjustments || []).filter(entry => entry.date <= cutoff).map(entry => ({
          transactionId: `adjustment:${entry.id}`, fundId: item.id, subFundName: item.name,
          date: entry.date, type: 'adjustment', description: entry.note, amount: entry.amountCents / 100,
        })),
        ...history.filter(entry => entry.periodStart <= cutoff).map(entry => ({
          transactionId: `allocation:${item.id}:${entry.periodStart}`, fundId: item.id, subFundName: item.name,
          date: entry.periodStart, periodStart: entry.periodStart,
          type: isOpening(entry) ? 'opening' : 'allocation',
          description: isOpening(entry) ? 'Opening balance' : 'Automatic allocation',
          amount: entry.allocationCents / 100, removed: Boolean(entry.removedAt),
        })),
        ...transactions.filter(row => row.accountKey === item.accountKey
          && matchesFundSelectors(item, row) && row.date >= getFundSpendingStart(item)
          && row.date <= cutoff && ['actual', 'pending'].includes(row.type)).map(row => ({
          ...row, fundId: item.id, subFundName: item.name,
          excluded: item.excludedTransactionIds.includes(String(row.transactionId)),
        })),
      ];
    }).filter(row => row.type !== 'opening' || row.amount !== 0)
      .sort((a, b) => b.date.localeCompare(a.date) || String(a.transactionId).localeCompare(String(b.transactionId)));
  }

  async getProjection(accountKey, anchorDate, endDate) {
    const listed = this.repository.listByAccount(accountKey, { includeDisabled: false });
    const funds = listed.filter(fund => !fund.parentId || listed.some(parent => parent.id === fund.parentId)).map(fund => ({ ...fund, recordedAllocationHistory: this.repository.getAllocationHistory(fund.id) }));
    if (funds.length === 0) {
      return { currentFunds: [], currentReservedCents: 0, days: [] };
    }

    const checkpoints = new Map();
    const transactionStart = earliest(funds.map(fund => {
      let checkpoint = this.repository.getCurrentState(fund.id);
      // Rebuild dated adjustments and manual spending from opening. The schedule
      // activation date prevents that replay from inventing earlier contributions.
      if ((fund.adjustments?.length || fund.scheduleStartedOn || fund.removedAllocationPeriods?.length || fund.includePriorSpending) && fund.periodType !== 'all-time') {
        const firstRecorded = fund.recordedAllocationHistory.at(-1);
        const replayStart = fund.includePriorSpending
          ? fund.fundType === 'sinking' && (fund.scheduleStartedOn || fund.adjustments?.length)
            ? fund.createdOn
            : firstRecorded?.periodStart || checkpoint?.periodStart || getPeriodForDate(fund, anchorDate).start
          : fund.fundType === 'operating' ? firstRecorded?.periodStart || anchorDate : fund.createdOn;
        const opening = getPeriodForDate(fund, replayStart);
        const recordedOpening = fund.recordedAllocationHistory.find(entry => entry.periodStart === opening.start);
        const originalOpening = fund.recordedAllocationHistory.find(entry => isOpeningFundAllocation(fund, entry));
        checkpoint = { periodStart: opening.start,
          allocationCents: (fund.fundType === 'sinking' ? originalOpening?.allocationCents : recordedOpening?.allocationCents) ?? (fund.fundType === 'sinking' ? fund.initialBalanceCents : fund.allocationCents),
          carryInCents: fund.fundType === 'operating' ? recordedOpening?.carryInCents || 0 : 0 };
      }
      if (checkpoint) checkpoints.set(fund.id, checkpoint);
      fund.historicalSpendingPeriodStart = checkpoint?.periodStart || getPeriodForDate(fund, anchorDate).start;
      return fund.includePriorSpending ? getFundSpendingStart(fund) : fund.historicalSpendingPeriodStart;
    }));

    const transactions = await this.lunchMoneyService.getTransactions(
      transactionStart,
      endDate,
      anchorDate
    );
    const projection = projectOperationalFunds({
      funds,
      checkpoints,
      transactions,
      accountKey,
      anchorDate,
      endDate,
    });

    for (const state of projection.currentFunds) {
      if (state.allocationMode === 'scheduled' && state.periodType !== 'all-time') {
        this.repository.saveAllocationHistory(state.id, state.allocationHistory);
        state.allocationHistory = this.repository.getAllocationHistory(state.id);
      }
      this.repository.saveCurrentState({
        fundId: state.id,
        periodStart: state.periodStart,
        periodEnd: state.periodEnd,
        allocationCents: state.allocationCents,
        carryInCents: state.carryInCents,
        remainingCents: state.remainingCents,
        calculatedThrough: anchorDate,
      });
    }

    return rollUpFundProjection(projection, funds);
  }
}
