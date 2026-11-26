import { addDays, getPeriodForDate } from './periods.js';

const fundTypeFor = fund => fund.fundType || (fund.periodType === 'all-time' ? 'reserved' : 'operating');
export const getFundSpendingStart = fund => fund.includePriorSpending ? '1900-01-01' : fund.createdOn || fund.createdAt?.slice(0, 10);

const allocationModeFor = fund => fund.allocationMode || (fundTypeFor(fund) === 'reserved' ? 'manual' : 'scheduled');

// The original period may no longer match the Fund's current schedule after
// disabling or editing it. Identify opening funding using its recorded bounds.
export const isOpeningFundAllocation = (fund, allocation) => fundTypeFor(fund) === 'sinking'
  && fund.createdOn >= allocation.periodStart
  && fund.createdOn <= allocation.periodEnd;


const isMappedTransaction = (fund, transaction, startDate, endDate, anchorDate) => {
  if (transaction.accountKey !== fund.accountKey) return false;
  if (fundTypeFor(fund) === 'sinking' && getFundSpendingStart(fund) && transaction.date < getFundSpendingStart(fund)) return false;
  if (!fund.categoryIds.includes(Number(transaction.categoryId))) return false;
  if (transaction.amount === 0) return false;
  if (transaction.date < startDate || transaction.date > endDate) return false;
  if (transaction.type === 'pending' && transaction.date < anchorDate) return false;
  return transaction.type === 'actual' || transaction.type === 'pending';
};

const isFutureMappedTransaction = (fund, transaction, date) =>
  transaction.accountKey === fund.accountKey &&
  fund.categoryIds.includes(Number(transaction.categoryId)) &&
  !fund.excludedTransactionIds.includes(String(transaction.transactionId)) &&
  transaction.amount !== 0 &&
  transaction.date === date &&
  ['actual', 'pending', 'future'].includes(transaction.type);

const transactionsForPeriod = (fund, transactions, period, throughDate, anchorDate) =>
  transactions.filter(transaction => isMappedTransaction(
    fund,
    transaction,
    fund.includePriorSpending && (fund.periodType === 'all-time' || period.start === fund.historicalSpendingPeriodStart)
      ? getFundSpendingStart(fund) : period.start,
    throughDate,
    anchorDate
  )).map(transaction => ({
    ...transaction,
    excluded: fund.excludedTransactionIds.includes(String(transaction.transactionId)),
  })).sort((left, right) => left.date.localeCompare(right.date) || String(left.transactionId).localeCompare(String(right.transactionId)));

export const getRolloverCarry = (remainingCents, mode, capCents) => {
  if (mode === 'full') return Math.max(0, remainingCents);
  if (mode === 'capped') return Math.min(Math.max(0, remainingCents), Math.max(0, capCents || 0));
  return 0;
};

const annotateTransactions = (transactions, startingCents) => {
  let balanceCents = startingCents;
  let remainingCents = Math.max(0, balanceCents);
  const annotated = transactions.map(transaction => {
    const amountCents = Math.round(transaction.amount * 100);
    const spendingCents = Math.max(0, -amountCents);
    const refundCents = Math.max(0, amountCents);
    const potentialCoveredCents = Math.min(remainingCents, spendingCents);
    const potentialOverBudgetCents = spendingCents - potentialCoveredCents;
    const coveredCents = transaction.excluded ? 0 : potentialCoveredCents;
    const overBudgetCents = transaction.excluded ? 0 : potentialOverBudgetCents;
    const startingRemainingCents = remainingCents;
    if (!transaction.excluded) balanceCents += amountCents;
    remainingCents = Math.max(0, balanceCents);
    const restoredCents = Math.max(0, remainingCents - startingRemainingCents);
    return {
      ...transaction,
      spendingCents,
      refundCents,
      restoredCents,
      startingRemainingCents,
      coveredCents,
      overBudgetCents,
      remainingAfterCents: remainingCents,
      potentialCoveredCents,
      potentialOverBudgetCents,
    };
  });
  return { annotated, remainingCents, balanceCents };
};

const stateForPeriod = (fund, period, allocationCents, carryInCents, transactions, throughDate, anchorDate) => {
  const periodTransactions = [
    ...transactionsForPeriod(fund, transactions, period, throughDate, anchorDate),
    ...(fund.adjustments || []).filter(entry => entry.date >= (fund.includePriorSpending && period.start === fund.historicalSpendingPeriodStart ? (fund.createdOn < period.start ? fund.createdOn : period.start) : period.start) && entry.date <= throughDate).map(entry => ({
      transactionId: `adjustment:${entry.id}`, date: entry.date, description: entry.note,
      amount: entry.amountCents / 100, type: 'adjustment', excluded: false,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'adjustment' ? -1 : b.type === 'adjustment' ? 1 : String(a.transactionId).localeCompare(String(b.transactionId))));
  const drawdown = annotateTransactions(periodTransactions, allocationCents + carryInCents);
  return {
    fundId: fund.id,
    periodStart: period.start,
    periodEnd: period.end,
    allocationCents,
    carryInCents,
    remainingCents: drawdown.remainingCents,
    balanceCents: drawdown.balanceCents,
    calculatedThrough: throughDate,
    periodTransactions: drawdown.annotated,
  };
};

const initialPeriodAllocation = fund => fundTypeFor(fund) === 'sinking'
  ? fund.initialBalanceCents
  : fund.allocationCents;

const contributionForBoundary = (fund, remainingCents, date, anchorDate) => {
  if (fund.removedAllocationPeriods?.includes(date)) return 0;
  // Saved past contributions are actual funding, not today's schedule applied
  // retroactively. Keep their amounts when replaying spending or adjustments.
  const recorded = date <= anchorDate && fund.recordedAllocationHistory?.find(entry => entry.periodStart === date);
  if (recorded) return recorded.allocationCents;
  if (fund.scheduleStartedOn && date <= fund.scheduleStartedOn) return 0;
  if (allocationModeFor(fund) !== 'scheduled') return 0;
  if (fundTypeFor(fund) !== 'sinking' || fund.targetCents == null) return fund.allocationCents;
  return Math.min(fund.allocationCents, Math.max(0, fund.targetCents - remainingCents));
};

export const calculateCurrentFundState = (fund, checkpoint, transactions, anchorDate) => {
  const currentPeriod = getPeriodForDate(fund, anchorDate);
  const allocationHistory = [];
  const recordPeriod = state => {
    if (allocationModeFor(fund) === 'scheduled' && fund.periodType !== 'all-time' && (!fund.scheduleStartedOn || state.periodStart > fund.scheduleStartedOn || fund.recordedAllocationHistory?.some(entry => entry.periodStart === state.periodStart))) {
      allocationHistory.push({
        periodStart: state.periodStart,
        periodEnd: state.periodEnd,
        allocationCents: state.allocationCents,
        carryInCents: state.carryInCents,
      });
    }
    return { ...state, allocationHistory };
  };

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
    return recordPeriod(stateForPeriod(
      fund,
      currentPeriod,
      initialPeriodAllocation(fund),
      0,
      transactions,
      anchorDate,
      anchorDate
    ));
  }

  let period = getPeriodForDate(fund, checkpoint.periodStart);
  let state = stateForPeriod(
    fund,
    period,
    fund.removedAllocationPeriods?.includes(period.start) ? 0
      : period.start === currentPeriod.start && fundTypeFor(fund) === 'operating' && !fund.recordedAllocationHistory?.some(entry => entry.periodStart === period.start)
        ? fund.allocationCents
        : checkpoint.allocationCents,
    checkpoint.carryInCents,
    transactions,
    period.start === currentPeriod.start ? anchorDate : period.end,
    anchorDate
  );
  recordPeriod(state);

  while (period.start < currentPeriod.start) {
    const carryInCents = fundTypeFor(fund) === 'sinking'
      ? state.remainingCents
      : getRolloverCarry(state.remainingCents, fund.rolloverMode, fund.rolloverCapCents);
    period = getPeriodForDate(fund, period.nextStart);
    const allocationCents = contributionForBoundary(fund, carryInCents, period.start, anchorDate);
    state = stateForPeriod(
      fund,
      period,
      allocationCents,
      carryInCents,
      transactions,
      period.start === currentPeriod.start ? anchorDate : period.end,
      anchorDate
    );
    recordPeriod(state);
  }

  return { ...state, allocationHistory };
};

const publicFundState = (fund, state) => ({
  id: fund.id,
  parentId: fund.parentId,
  occasionDate: fund.occasionDate,
  purchasedOn: fund.purchasedOn,
  adjustments: fund.adjustments || [],
  accountKey: fund.accountKey,
  name: fund.name,
  fundType: fundTypeFor(fund),
  allocationMode: allocationModeFor(fund),
  scheduleStartedOn: fund.scheduleStartedOn,
  includePriorSpending: fund.includePriorSpending,
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
  allocationHistory: state.allocationHistory || [],
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
      balanceCents: state.balanceCents,
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
          const allocationCents = contributionForBoundary(fund, carryInCents, date, anchorDate);
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
            balanceCents: resultingRemainingCents,
            projectedReserveCents,
            periodStart: date,
            periodEnd: period.end,
            nextPeriodStart: period.nextStart,
          };
        }

        const todaysTransactions = transactions.filter(transaction => isFutureMappedTransaction(fund, transaction, date));
        const drawdown = annotateTransactions(todaysTransactions, fundState.balanceCents);
        const spendingCents = drawdown.annotated.reduce((sum, transaction) => sum + transaction.spendingCents, 0);
        const refundCents = drawdown.annotated.reduce((sum, transaction) => sum + transaction.refundCents, 0);
        const coveredCents = drawdown.annotated.reduce((sum, transaction) => sum + transaction.coveredCents, 0);
        const restoredCents = drawdown.annotated.reduce((sum, transaction) => sum + transaction.restoredCents, 0);
        if (spendingCents > 0 || refundCents > 0) {
          transactionDrawdowns.push({
            fundId: fund.id,
            name: fund.name,
            spendingCents,
            coveredCents,
            refundCents,
            restoredCents,
            remainingCents: drawdown.remainingCents,
          });
          fundState = {
            ...fundState,
            remainingCents: drawdown.remainingCents,
            balanceCents: drawdown.balanceCents,
            projectedReserveCents: fundState.projectedReserveCents - coveredCents + restoredCents,
          };
        }
        const adjustmentCents = (fund.adjustments || []).filter(entry => entry.date === date).reduce((sum, entry) => sum + entry.amountCents, 0);
        if (adjustmentCents) {
          const balanceCents = fundState.balanceCents + adjustmentCents;
          const remainingCents = Math.max(0, balanceCents);
          fundState = { ...fundState, balanceCents, remainingCents,
            projectedReserveCents: fundState.projectedReserveCents + remainingCents - fundState.remainingCents };
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

// Reserve calculations use the flat funds once. Presentation rolls children into
// their parent; the parent's own balance is the unassigned part of that total.
export const rollUpFundProjection = (projection, funds) => {
  const byId = new Map(funds.map(fund => [fund.id, fund]));
  const rootId = id => byId.get(id)?.parentId || id;
  const group = states => {
    const roots = states.filter(state => !byId.get(state.id)?.parentId);
    return roots.map(root => {
      const children = states.filter(state => byId.get(state.id)?.parentId === root.id);
      if (!children.length) return root;
      const sum = key => [root, ...children].reduce((total, state) => total + (state[key] || 0), 0);
      return { ...root, children, ownRemainingCents: root.remainingCents,
        remainingCents: sum('remainingCents'), projectedReserveCents: sum('projectedReserveCents'),
        transactions: [root, ...children].flatMap(state => (state.transactions || []).map(row => ({ ...row, fundId: state.id, subFundName: state.id === root.id ? 'Unassigned' : state.name }))).sort((a, b) => a.date.localeCompare(b.date)),
      };
    });
  };
  const annotations = rows => rows.map(row => ({ ...row, sourceFundId: row.fundId, sourceFundName: row.name,
    fundId: rootId(row.fundId), name: byId.get(rootId(row.fundId))?.name || row.name }));
  return { ...projection, currentFunds: group(projection.currentFunds), days: projection.days.map(day => ({ ...day,
    funds: group(day.funds), boundaryAnnotations: annotations(day.boundaryAnnotations), transactionDrawdowns: annotations(day.transactionDrawdowns),
  })) };
};
