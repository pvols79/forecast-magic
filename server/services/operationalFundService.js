import { getPeriodForDate } from '../domain/periods.js';
import { projectOperationalFunds } from '../domain/operationalFunds.js';
import { OperationalFundRepository } from '../repositories/operationalFundRepository.js';
import { LunchMoneyService } from './lunchMoneyService.js';

const earliest = dates => dates.reduce((minimum, date) => !minimum || date < minimum ? date : minimum, null);

export class OperationalFundService {
  constructor(
    repository = new OperationalFundRepository(),
    lunchMoneyService = new LunchMoneyService()
  ) {
    this.repository = repository;
    this.lunchMoneyService = lunchMoneyService;
  }

  async getProjection(accountKey, anchorDate, endDate) {
    const funds = this.repository.listByAccount(accountKey, { includeDisabled: false });
    if (funds.length === 0) {
      return { currentFunds: [], currentReservedCents: 0, days: [] };
    }

    const checkpoints = new Map();
    const transactionStart = earliest(funds.map(fund => {
      const checkpoint = this.repository.getCurrentState(fund.id);
      if (checkpoint) checkpoints.set(fund.id, checkpoint);
      return checkpoint?.periodStart || getPeriodForDate(fund, anchorDate).start;
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

    return projection;
  }
}
