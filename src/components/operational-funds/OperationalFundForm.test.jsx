import React from 'react';
import { renderToString } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { describe, expect, it } from 'vitest';
import OperationalFundForm from './OperationalFundForm';
import { createFundFormValue, toggleSinkingAutoAllocation } from './fundFormState';

const manualFund = {
  id: 12, accountKey: 'plaid:1', name: 'Birthday gifts', parentId: 2,
  fundType: 'sinking', allocationMode: 'manual', periodType: 'all-time',
  weeklyStartDay: null, anchorMonth: null, anchorDay: null,
  allocationCents: 5000, initialBalanceCents: 10000, targetCents: 25000,
  categoryIds: [10], active: true,
};

const renderForm = fund => renderToString(
  <ChakraProvider><OperationalFundForm accountKey="plaid:1" categories={[]} fund={fund} onSave={() => {}} onCancel={() => {}} /></ChakraProvider>
);

describe('Fund allocation schedule controls', () => {
  it('enables monthly allocation on a persisted manual sub-fund without a null-input crash', () => {
    const scheduled = toggleSinkingAutoAllocation(manualFund, true);
    expect(scheduled).toMatchObject({ allocationMode: 'scheduled', periodType: 'monthly', anchorDay: 1, anchorMonth: 1, weeklyStartDay: 1, parentId: 2, initialBalanceCents: 10000, allocationCents: 5000, categoryIds: [10] });
    expect(() => renderForm(scheduled)).not.toThrow();
    expect(renderForm(scheduled)).toContain('Anchor Day');
  });

  it('supplies defaults for a newly added sub-fund with omitted schedule fields', () => {
    const value = toggleSinkingAutoAllocation({ accountKey: 'plaid:1', fundType: 'sinking', periodType: 'all-time', categoryIds: [] }, true);
    expect(value.anchorDay).toBe(1);
    expect(() => renderForm(value)).not.toThrow();
  });

  it('keeps a chosen monthly allocation day when toggled off and back on', () => {
    const disabled = toggleSinkingAutoAllocation({ ...manualFund, periodType: 'monthly', anchorDay: 15 }, false);
    const enabled = toggleSinkingAutoAllocation(disabled, true);
    expect(enabled.anchorDay).toBe(15);
    expect(enabled.periodType).toBe('monthly');
  });

  it.each(['weekly', 'monthly', 'quarterly', 'yearly'])('renders %s scheduling for stored null fields', periodType => {
    const value = createFundFormValue('plaid:1', { ...manualFund, allocationMode: 'scheduled', periodType });
    expect(() => renderForm(value)).not.toThrow();
  });
});
