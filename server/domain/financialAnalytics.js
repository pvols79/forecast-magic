import { addDays } from './periods.js';

const toCents = amount => Math.round(Number(amount || 0) * 100);
const normalizedName = value => String(value || '').trim().toLowerCase();

const projectionPoint = day => day ? {
  date: day.date,
  availableCents: toCents(day.availableBalance ?? day.balance),
  ledgerBalanceCents: toCents(day.ledgerBalance ?? day.balance),
  reservedFundCents: toCents(day.reservedOperationalFunds),
} : null;

const lowestPoint = (days, startDate, endDate) => {
  const points = days
    .filter(day => day.date >= startDate && day.date <= endDate)
    .map(projectionPoint);
  return points.reduce((lowest, point) => (
    !lowest || point.availableCents < lowest.availableCents ? point : lowest
  ), null);
};

export const summarizeCashPosition = (projection, anchorDate) => {
  const days = projection?.dailyBalances || [];
  return {
    asOfDate: anchorDate,
    availableToday: projectionPoint(days.find(day => day.date === anchorDate) || days[0]),
    thirtyDayLow: lowestPoint(days, anchorDate, addDays(anchorDate, 29)),
    ninetyDayLow: lowestPoint(days, anchorDate, addDays(anchorDate, 89)),
    sixMonthSnapshot: projectionPoint(days.at(-1)),
    projectionSeries: days.map(projectionPoint),
  };
};

const attentionEvent = event => ({
  id: event.id,
  recurringId: event.recurringId,
  accountKey: event.accountKey,
  date: event.date,
  description: event.description,
  amountCents: toCents(event.amount),
  type: event.type,
  status: event.status,
  transactionId: event.transactionId,
});

export const summarizeRecurringAttention = (missingEvents, occurrences, accountKey, anchorDate) => {
  const dueThrough = addDays(anchorDate, 2);
  const missing = missingEvents
    .filter(event => event.accountKey === accountKey && event.type === 'recurring-projected')
    .sort((left, right) => left.date.localeCompare(right.date) || left.description.localeCompare(right.description));
  const upcomingExpenses = occurrences
    .filter(event => event.accountKey === accountKey)
    .filter(event => event.amount < 0)
    .filter(event => event.date >= anchorDate && event.date <= dueThrough)
    .filter(event => event.status !== 'matched')
    .sort((left, right) => left.date.localeCompare(right.date) || left.description.localeCompare(right.description));
  return {
    asOfDate: anchorDate,
    dueThrough,
    pastDueRecurring: missing.filter(event => event.date < anchorDate).map(attentionEvent),
    dueWithin48Hours: upcomingExpenses.map(attentionEvent),
  };
};

const categoryDetails = category => ({
  categoryId: category?.id ?? null,
  categoryName: category?.name || 'Uncategorized',
  categoryGroupName: category?.groupName || null,
});

const postedExpenses = (transactions, categoriesById, accountKey, startDate, endDate) =>
  transactions.filter(transaction => {
    if (transaction.accountKey !== accountKey) return false;
    if (transaction.date < startDate || transaction.date > endDate) return false;
    if (transaction.amount >= 0 || transaction.type !== 'actual') return false;
    if (transaction.lunchMoneySource === 'recurring') return false;
    const category = categoriesById.get(Number(transaction.categoryId));
    return !category?.isIncome && !category?.excludeFromTotals;
  });

const spendingCents = transaction => Math.round(Math.abs(transaction.amount) * 100);

const groupCategorySpending = (transactions, categoriesById) => {
  const totals = new Map();
  for (const transaction of transactions) {
    const category = categoriesById.get(Number(transaction.categoryId));
    const key = category ? String(category.id) : 'uncategorized';
    const current = totals.get(key) || { ...categoryDetails(category), amountCents: 0, transactionCount: 0 };
    current.amountCents += spendingCents(transaction);
    current.transactionCount += 1;
    totals.set(key, current);
  }
  return [...totals.values()].sort((left, right) => right.amountCents - left.amountCents || left.categoryName.localeCompare(right.categoryName));
};

const TRACKED_CATEGORY_ALIASES = {
  gas: new Set(['auto fuel', 'fuel', 'gas', 'gasoline']),
  dining: new Set(['dining', 'dining out', 'fast food', 'restaurant', 'restaurants']),
  groceries: new Set(['groceries', 'grocery']),
};

const trackedCategoryIds = (categories, aliases) => categories
  .filter(category => aliases.has(normalizedName(category.name)) || aliases.has(normalizedName(category.groupName)))
  .map(category => Number(category.id));

const trendDirection = (currentCents, previousCents) => {
  if (currentCents === previousCents) return 'flat';
  if (previousCents === 0) return currentCents > 0 ? 'new' : 'flat';
  return currentCents > previousCents ? 'up' : 'down';
};

const categoryTrend = (name, categories, currentTransactions, previousTransactions) => {
  const categoryIds = trackedCategoryIds(categories, TRACKED_CATEGORY_ALIASES[name]);
  const idSet = new Set(categoryIds);
  const sum = transactions => transactions
    .filter(transaction => idSet.has(Number(transaction.categoryId)))
    .reduce((total, transaction) => total + spendingCents(transaction), 0);
  const currentCents = sum(currentTransactions);
  const previousCents = sum(previousTransactions);
  return {
    key: name,
    categoryIds,
    currentCents,
    previousCents,
    changeCents: currentCents - previousCents,
    changePercent: previousCents === 0 ? null : (currentCents - previousCents) / previousCents * 100,
    direction: trendDirection(currentCents, previousCents),
  };
};

export const summarizeSpendingTrends = (transactions, categories, accountKey, anchorDate) => {
  const categoriesById = new Map(categories.map(category => [Number(category.id), category]));
  const currentStart = addDays(anchorDate, -29);
  const previousStart = addDays(anchorDate, -59);
  const previousEnd = addDays(anchorDate, -30);
  const currentTransactions = postedExpenses(transactions, categoriesById, accountKey, currentStart, anchorDate);
  const previousTransactions = postedExpenses(transactions, categoriesById, accountKey, previousStart, previousEnd);
  return {
    currentWindow: { startDate: currentStart, endDate: anchorDate },
    previousWindow: { startDate: previousStart, endDate: previousEnd },
    topCategories: groupCategorySpending(currentTransactions, categoriesById).slice(0, 3),
    tracked: {
      gas: categoryTrend('gas', categories, currentTransactions, previousTransactions),
      dining: categoryTrend('dining', categories, currentTransactions, previousTransactions),
      groceries: categoryTrend('groceries', categories, currentTransactions, previousTransactions),
    },
  };
};

const expenditure = (transaction, categoriesById) => ({
  transactionId: transaction.transactionId,
  date: transaction.date,
  payee: transaction.description,
  amountCents: spendingCents(transaction),
  ...categoryDetails(categoriesById.get(Number(transaction.categoryId))),
});

export const summarizeUnallocatedSpending = (transactions, categories, funds, accountKey, anchorDate) => {
  const categoriesById = new Map(categories.map(category => [Number(category.id), category]));
  const allocatedCategoryIds = new Set(
    funds.flatMap(fund => fund.categoryIds || []).map(Number)
  );
  const startDate = addDays(anchorDate, -29);
  const unallocated = postedExpenses(transactions, categoriesById, accountKey, startDate, anchorDate)
    .filter(transaction => transaction.recurringId == null)
    .filter(transaction => !allocatedCategoryIds.has(Number(transaction.categoryId)));
  const expenditures = unallocated
    .map(transaction => expenditure(transaction, categoriesById))
    .sort((left, right) => right.amountCents - left.amountCents || right.date.localeCompare(left.date));
  const payees = new Map();
  for (const item of expenditures) {
    const key = normalizedName(item.payee) || 'unknown';
    const current = payees.get(key) || { payee: item.payee || 'Unknown', amountCents: 0, transactionCount: 0 };
    current.amountCents += item.amountCents;
    current.transactionCount += 1;
    payees.set(key, current);
  }
  const topPayee = [...payees.values()]
    .sort((left, right) => right.amountCents - left.amountCents || left.payee.localeCompare(right.payee))[0] || null;
  return {
    window: { startDate, endDate: anchorDate },
    totalCents: expenditures.reduce((total, item) => total + item.amountCents, 0),
    transactionCount: expenditures.length,
    topExpenditures: expenditures.slice(0, 5),
    largestExpense: expenditures[0] || null,
    topPayee,
  };
};

export const householdFundCards = funds => funds
  .filter(fund => fund.householdVisible)
  .map(fund => ({
    id: fund.id,
    accountKey: fund.accountKey,
    name: fund.name,
    fundType: fund.fundType,
    allocationMode: fund.allocationMode,
    periodType: fund.periodType,
    periodStart: fund.periodStart,
    periodEnd: fund.periodEnd,
    remainingCents: fund.remainingCents,
    targetCents: fund.targetCents,
    scheduledAllocationCents: fund.scheduledAllocationCents,
  }));
