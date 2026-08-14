export const applyOperationalFunds = (ledgerProjection, operationalFundProjection = {}) => {
  if (!ledgerProjection) return null;

  const fundDays = new Map((operationalFundProjection.days || []).map(day => [day.date, day]));
  const dailyBalances = ledgerProjection.dailyBalances.map(day => {
    const fundDay = fundDays.get(day.date) || {
      totalReservedCents: 0,
      funds: [],
      boundaryAnnotations: [],
    };
    const reservedOperationalFunds = fundDay.totalReservedCents / 100;
    return {
      ...day,
      ledgerBalance: day.balance,
      reservedOperationalFunds,
      availableBalance: day.balance - reservedOperationalFunds,
      balance: day.balance - reservedOperationalFunds,
      operationalFunds: fundDay.funds,
      operationalFundAnnotations: fundDay.boundaryAnnotations,
    };
  });

  const negativeBalanceAlerts = dailyBalances
    .filter(day => day.availableBalance < 0)
    .filter(day => ledgerProjection.keyEvents.some(event => event.date === day.date && !event.is_subtotal) || day.operationalFundAnnotations.length > 0)
    .map(day => ({
      date: day.date,
      balance: day.availableBalance,
      transaction: ledgerProjection.keyEvents.filter(event => event.date === day.date && !event.is_subtotal).at(-1) || {
        description: 'Fund Allocation',
      },
    }));

  return {
    ...ledgerProjection,
    ledgerDailyBalances: ledgerProjection.dailyBalances,
    dailyBalances,
    negativeBalanceAlerts,
    operationalFunds: operationalFundProjection.currentFunds || [],
    currentReservedOperationalFunds: (operationalFundProjection.currentReservedCents || 0) / 100,
    openingBalance: ledgerProjection.openingBalance ? {
      ...ledgerProjection.openingBalance,
      reservedOperationalFunds: dailyBalances[0]?.reservedOperationalFunds || 0,
      availableToSpend: dailyBalances[0]?.availableBalance ?? ledgerProjection.openingBalance.ledgerBalance,
    } : null,
  };
};
