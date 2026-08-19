export const selectUpcomingEvents = (
  events = [],
  historicalMissedEvents = [],
  anchorDate
) => {
  const futureEvents = events.filter(event => (
    event.date > anchorDate && !event.is_subtotal
  ));
  const missedEvents = historicalMissedEvents.map(event => ({
    ...event,
    balance: undefined,
    is_historical_missed: true,
  }));

  return [...missedEvents, ...futureEvents].sort((left, right) => (
    left.date.localeCompare(right.date)
    || String(left.description || '').localeCompare(String(right.description || ''))
    || String(left.id || '').localeCompare(String(right.id || ''))
  ));
};
