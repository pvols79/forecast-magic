// Manual/all-time funds store null schedule fields. Form controls require
// concrete defaults when an allocation schedule is enabled.
export const createFundFormValue = (accountKey, fund = {}) => ({
  accountKey,
  name: '',
  fundType: 'operating',
  allocationMode: 'scheduled',
  allocationCents: 0,
  initialBalanceCents: 0,
  periodType: 'weekly',
  rolloverMode: 'none',
  rolloverCapCents: null,
  targetCents: null,
  householdVisible: false,
  active: true,
  ...fund,
  weeklyStartDay: fund?.weeklyStartDay ?? 1,
  anchorMonth: fund?.anchorMonth ?? 1,
  anchorDay: fund?.anchorDay ?? 1,
  categoryIds: fund?.categoryIds ?? [],
});

export const toggleSinkingAutoAllocation = (current, enabled) => ({
  ...createFundFormValue(current.accountKey, current),
  allocationMode: enabled ? 'scheduled' : 'manual',
  periodType: enabled
    ? (!current.periodType || current.periodType === 'all-time' ? 'monthly' : current.periodType)
    : 'all-time',
  rolloverMode: enabled ? 'full' : 'none',
});
