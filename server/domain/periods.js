const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDate = date => {
  if (!DATE_PATTERN.test(date)) throw new Error(`Invalid date: ${date}`);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

export const formatDate = date => [
  date.getUTCFullYear(),
  String(date.getUTCMonth() + 1).padStart(2, '0'),
  String(date.getUTCDate()).padStart(2, '0'),
].join('-');

export const addDays = (date, days) => {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatDate(value);
};

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const clampedDate = (year, month, day) => {
  const monthIndex = year * 12 + month - 1;
  const normalizedYear = Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12 + 1;
  const normalizedDay = Math.min(day, daysInMonth(normalizedYear, normalizedMonth));
  return `${normalizedYear}-${String(normalizedMonth).padStart(2, '0')}-${String(normalizedDay).padStart(2, '0')}`;
};

const monthlyPeriod = (date, anchorDay) => {
  const parsed = parseDate(date);
  let monthIndex = parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
  let start = clampedDate(Math.floor(monthIndex / 12), monthIndex % 12 + 1, anchorDay);
  if (date < start) monthIndex -= 1;
  start = clampedDate(Math.floor(monthIndex / 12), monthIndex % 12 + 1, anchorDay);
  const next = clampedDate(Math.floor((monthIndex + 1) / 12), (monthIndex + 1) % 12 + 1, anchorDay);
  return { start, end: addDays(next, -1), nextStart: next };
};

const quarterlyPeriod = (date, anchorMonth, anchorDay) => {
  const parsed = parseDate(date);
  const dateMonthIndex = parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
  const baseMonthIndex = 2000 * 12 + anchorMonth - 1;
  let quarterIndex = Math.floor((dateMonthIndex - baseMonthIndex) / 3);
  let startMonthIndex = baseMonthIndex + quarterIndex * 3;
  let start = clampedDate(Math.floor(startMonthIndex / 12), startMonthIndex % 12 + 1, anchorDay);
  if (date < start) {
    quarterIndex -= 1;
    startMonthIndex = baseMonthIndex + quarterIndex * 3;
    start = clampedDate(Math.floor(startMonthIndex / 12), startMonthIndex % 12 + 1, anchorDay);
  }
  const nextMonthIndex = startMonthIndex + 3;
  const next = clampedDate(Math.floor(nextMonthIndex / 12), nextMonthIndex % 12 + 1, anchorDay);
  return { start, end: addDays(next, -1), nextStart: next };
};

const yearlyPeriod = (date, anchorMonth, anchorDay) => {
  const year = parseDate(date).getUTCFullYear();
  let startYear = year;
  let start = clampedDate(startYear, anchorMonth, anchorDay);
  if (date < start) {
    startYear -= 1;
    start = clampedDate(startYear, anchorMonth, anchorDay);
  }
  const next = clampedDate(startYear + 1, anchorMonth, anchorDay);
  return { start, end: addDays(next, -1), nextStart: next };
};

const weeklyPeriod = (date, weeklyStartDay) => {
  const parsed = parseDate(date);
  const daysSinceStart = (parsed.getUTCDay() - weeklyStartDay + 7) % 7;
  const start = addDays(date, -daysSinceStart);
  const next = addDays(start, 7);
  return { start, end: addDays(next, -1), nextStart: next };
};

export const getPeriodForDate = (fund, date) => {
  switch (fund.periodType) {
    case 'weekly':
      return weeklyPeriod(date, fund.weeklyStartDay ?? 1);
    case 'monthly':
      return monthlyPeriod(date, fund.anchorDay ?? 1);
    case 'quarterly':
      return quarterlyPeriod(date, fund.anchorMonth ?? 1, fund.anchorDay ?? 1);
    case 'yearly':
      return yearlyPeriod(date, fund.anchorMonth ?? 1, fund.anchorDay ?? 1);
    case 'all-time':
      return { start: fund.createdOn || fund.createdAt.slice(0, 10), end: null, nextStart: null };
    default:
      throw new Error(`Unsupported period type: ${fund.periodType}`);
  }
};

export const getDateInTimezone = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const isValidTimezone = timezone => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};
