import { addDays } from '../server/domain/periods.js';

// The floor uses the same available balance as the chart, including all holds.
// Cover today plus the next 90 days even when the visible chart is shorter.
export const getNinetyDayLow = (days, anchorDate) => {
  const endDate = addDays(anchorDate, 90);
  const covered = days.filter(day => day.date >= anchorDate && day.date <= endDate);
  if (!covered.length || covered.at(-1).date !== endDate) return null;
  return covered.reduce((low, day) => day.availableBalance < low.availableBalance ? day : low);
};

export const allocationStatus = (fund, state) => {
  if (fund.archivedAt) return { label: 'Archived', color: 'gray' };
  if (!fund.active) return { label: 'Disabled', color: 'gray' };
  if (fund.allocationMode !== 'scheduled' || fund.periodType === 'all-time') return { label: 'Auto off', color: 'gray' };
  if (!state) return { label: 'Auto enabled · calculating', color: 'gray' };
  const own = state.ownRemainingCents ?? state.remainingCents;
  if (fund.fundType === 'sinking' && fund.targetCents != null && own >= fund.targetCents) {
    return { label: 'Auto paused · goal reached', color: 'orange' };
  }
  return { label: 'Auto active', color: 'green' };
};
