import { describe, expect, it } from 'vitest';
import { selectUpcomingEvents } from './upcomingEvents';

describe('selectUpcomingEvents', () => {
  it('combines unresolved historical misses with future projection events', () => {
    const events = [
      { id: 'posted', date: '2026-08-18', description: 'Paid bill', amount: -50, type: 'actual' },
      { id: 'today', date: '2026-08-19', description: 'Today activity', amount: -25, type: 'pending' },
      { id: 'future', date: '2026-08-20', description: 'Future bill', amount: -100, type: 'recurring-projected' },
      { id: 'subtotal', date: '2026-08-31', description: 'Monthly subtotal', amount: -100, is_subtotal: true },
    ];
    const historicalMissedEvents = [
      { id: 'missed', date: '2026-08-17', description: 'Missed bill', amount: -75, type: 'recurring-projected', balance: 2000 },
    ];

    expect(selectUpcomingEvents(events, historicalMissedEvents, '2026-08-19')).toEqual([
      expect.objectContaining({ id: 'missed', is_historical_missed: true, balance: undefined }),
      expect.objectContaining({ id: 'future' }),
    ]);
  });
});
