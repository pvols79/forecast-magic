import { addDays, getPeriodForDate } from './periods.js';

const fundTypeFor = fund => fund.fundType || (fund.periodType === 'all-time' ? 'reserved' : 'operating');
const allocationModeFor = fund => fund.allocationMode || (fundTypeFor(fund) === 'reserved' ? 'manual' : 'scheduled');

const isMappedTransaction = (fund, transaction, startDate, endDate, anchorDate) => {
  if (transaction.accountKey !== fund.accountKey) return false;
  if (!fund.categoryIds.includes(Number(transaction.categoryId))) return false;
  if (transaction.amount >= 0) return false;
  if (transaction.date < startDate || transaction.date > endDate) return false;
  if (transaction.type === 'pending' && transaction.date < anchorDate) return false;
  return transaction.type === 'actual' || transaction.type === 'pending';
};

const isFutureMappedTransaction = (fund, transaction, date) =>
  transaction.accountKey === fund.accountKey &&
  fund.categoryIds.includes(Number(transaction.categoryId)) &&
  !fund.excludedTransactionIds.includes(String(transaction.transactionId)) &&
  transaction.amount < 0 &&
  transaction.date === date &&
  ['actual', 'pending', 'future'].includes(transaction.type);

const transactionsForPeriod = (fund, transactions, period, throughDate, anchorDate) =>
  transactions.filter(transaction => isMappedTransaction(
    fund,
    transaction,
    period.start,
    throughDate,
    anchorDate
  )).map(transaction => ({
    ...transaction,
    excluded: fund.excludedTransactionIds.includes(String(transaction.transactionId)),
  })).sort((left, right) => left.date.localeCompare(right.date) || String(left.transactionId).localeCompare(String(right.transactionId)));

const spentCents = transactions => transactions.reduce(
  (sum, transaction) => sum + Math.round(Math.abs(transaction.amount) * 100),
  0
);

export const getRolloverCarry = (remainingCents, mode, capCents) => {
  if (mode === 'full') return Math.max(0, remainingCents);
  if (mode === 'capped') return Math.min(Math.max(0, remainingCents), Math.max(0, capCents || 0));
  return 0;
};

const annotateTransactions = (transactions, startingCents) => {
  let remainingCents = Math.max(0, startingCents);
  const annotated = transactions.map(transaction => {
    const spendingCents = Math.round(Math.abs(transaction.amount) * 100);
    const potentialCoveredCents = Math.min(remainingCents, spendingCents);
    const potentialOverBudgetCents = spendingCents - potentialCoveredCents;
    const coveredCents = transaction.excluded ? 0 : potentialCoveredCents;
    const overBudgetCents = transaction.excluded ? 0 : potentialOverBudgetCents;
    const startingRemainingCents = remainingCents;
    remainingCents -= coveredCents;
    return {
      ...transaction,
      spendingCents,
      startingRemainingCents,
      coveredCents,
      overBudgetCents,
      remainingAfterCents: remainingCents,
      potentialCoveredCents,
      potentialOverBudgetCents,
    };
  });
  return { annotated, remainingCents };
};

const stateForPeriod = (fund, period, allocationCents, carryInCents, transactions, throughDate, anchorDate) => {
  const periodTransactions = transactionsForPeriod(fund, transactions, period, throughDate, anchorDate);
  const drawdown = annotateTransactions(periodTransactions, allocationCents + carryInCents);
  return {
    fundId: fund.id,
    periodStart: period.start,
    periodEnd: period.end,
    allocationCents,
    carryInCents,
    remainingCents: drawdown.remainingCents,
    calculatedThrough: throughDate,
    periodTransactions: drawdown.annotated,
  };
};

const initialPeriodAllocation = fund => fundTypeFor(fund) === 'sinking'
  ? fund.initialBalanceCents
  : fund.allocationCents;

const contributionForBoundary = (fund, remainingCents) => {
  if (allocationModeFor(fund) !== 'scheduled') return 0;
  if (fundTypeFor(fund) !== 'sinking' || fund.targetCents == null) return fund.allocationCents;
  return Math.min(fund.allocationCents, Math.max(0, fund.targetCents - remainingCents));
};

export const calculateCurrentFundState = (fund, checkpoint, transactions, anchorDate) => {
  const currentPeriod = getPeriodForDate(fund, anchorDate);

  if (fund.periodType === 'all-time') {
    return stateForPeriod(
      fund,
      currentPeriod,
      initialPeriodAllocation(fund),
      0,
      transactions,
      anchorDate,
      anchorDate
    );
  }

  if (!checkpoint || checkpoint.periodStart > currentPeriod.start) {
    return stateForPeriod(
      fund,
      currentPeriod,
      initialPeriodAllocation(fund),
      0,
      transactions,
      anchorDate,
      anchorDate
    );
  }

  let period = getPeriodForDate(fund, checkpoint.periodStart);
  let state = stateForPeriod(
    fund,
    period,
    period.start === currentPeriod.start && fundTypeFor(fund) === 'operating'
      ? fund.allocationCents
      : checkpoint.allocationCents,
    checkpoint.carryInCents,
    transactions,
    period.start === currentPeriod.start ? anchorDate : period.end,
    anchorDate
  );

  while (period.start < currentPeriod.start) {
    const carryInCents = fundTypeFor(fund) === 'sinking'
      ? state.remainingCents
      : getRolloverCarry(state.remainingCents, fund.rolloverMode, fund.rolloverCapCents);
    period = getPeriodForDate(fund, period.nextStart);
    const allocationCents = contributionForBoundary(fund, carryInCents);
    state = stateForPeriod(
      fund,
      period,
      allocationCents,
      carryInCents,
      transactions,
      period.start === currentPeriod.start ? anchorDate : period.end,
      anchorDate
    );
  }

  return state;
};

const publicFundState = (fund, state) => ({
  id: fund.id,
  accountKey: fund.accountKey,
  name: fund.name,
  fundType: fundTypeFor(fund),
  allocationMode: allocationModeFor(fund),
  allocationCents: state.allocationCents,
  scheduledAllocationCents: fund.allocationCents,
  initialBalanceCents: fund.initialBalanceCents,
  carryInCents: state.carryInCents,
  remainingCents: state.remainingCents,
  periodType: fund.periodType,
  periodStart: state.periodStart,
  periodEnd: state.periodEnd,
  targetCents: fund.targetCents,
  householdVisible: fund.householdVisible,
  categoryIds: fund.categoryIds,
  transactions: state.periodTransactions,
});

export const projectOperationalFunds = ({ funds, checkpoints = new Map(), transactions = [], accountKey, anchorDate, endDate }) => {
  const activeFunds = funds.filter(fund => fund.active && (!accountKey || fund.accountKey === accountKey));
  const currentStates = activeFunds.map(fund => ({
    fund,
    state: calculateCurrentFundState(fund, checkpoints.get(fund.id), transactions, anchorDate),
  }));
  const runningFunds = new Map(currentStates.map(({ fund, state }) => [
    fund.id,
    {
      ...publicFundState(fund, state),
      nextPeriodStart: getPeriodForDate(fund, state.periodStart).nextStart,
      projectedReserveCents: state.remainingCents,
    },
  ]));
  const days = [];

  for (let date = anchorDate; date <= endDate; date = addDays(date, 1)) {
    const boundaryAnnotations = [];
    const transactionDrawdowns = [];

    if (date > anchorDate) {
      for (const fund of activeFunds) {
        let fundState = runningFunds.get(fund.id);
        if (fundState.nextPeriodStart === date) {
          const previousRemainingCents = fundState.remainingCents;
          const carryInCents = fundTypeFor(fund) === 'sinking'
            ? previousRemainingCents
            : getRolloverCarry(previousRemainingCents, fund.rolloverMode, fund.rolloverCapCents);
          const allocationCents = contributionForBoundary(fund, carryInCents);
          const resultingRemainingCents = allocationCents + carryInCents;
          const projectedReserveCents = fundState.projectedReserveCents + allocationCents;
          const period = getPeriodForDate(fund, date);
          boundaryAnnotations.push({
            fundId: fund.id,
            name: fund.name,
            allocationCents,
            carryInCents,
            previousRemainingCents,
            resultingRemainingCents,
            reservedDeltaCents: allocationCents,
            projectedReserveCents,
          });
          fundState = {
            ...fundState,
            carryInCents,
            remainingCents: resultingRemainingCents,
            projectedReserveCents,
            periodStart: date,
            periodEnd: period.end,
            nextPeriodStart: period.nextStart,
          };
        }

        const todaysTransactions = transactions.filter(transaction => isFutureMappedTransaction(fund, transaction, date));
        const spendingCents = spentCents(todaysTransactions);
        const coveredCents = Math.min(fundState.remainingCents, spendingCents);
        if (spendingCents > 0) {
          transactionDrawdowns.push({
            fundId: fund.id,
            name: fund.name,
            spendingCents,
            coveredCents,
            remainingCents: fundState.remainingCents - coveredCents,
          });
          fundState = {
            ...fundState,
            remainingCents: fundState.remainingCents - coveredCents,
            projectedReserveCents: fundState.projectedReserveCents - coveredCents,
          };
        }
        runningFunds.set(fund.id, fundState);
      }
    }

    const totalReservedCents = [...runningFunds.values()].reduce((sum, fund) => sum + fund.projectedReserveCents, 0);
    days.push({
      date,
      totalReservedCents,
      funds: [...runningFunds.values()].map(fund => ({
        id: fund.id,
        name: fund.name,
        remainingCents: fund.remainingCents,
        projectedReserveCents: fund.projectedReserveCents,
        targetCents: fund.targetCents,
        fundType: fundTypeFor(fund),
        allocationMode: allocationModeFor(fund),
        householdVisible: fund.householdVisible,
      })),
      boundaryAnnotations,
      transactionDrawdowns,
    });
  }

  return {
    currentFunds: currentStates.map(({ fund, state }) => publicFundState(fund, state)),
    currentReservedCents: days[0]?.totalReservedCents || 0,
    days,
  };
};
