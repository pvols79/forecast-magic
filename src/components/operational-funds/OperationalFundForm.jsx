import { useEffect, useState } from 'react';
import {
  Box, Button, Checkbox, CheckboxGroup, FormControl, FormLabel, HStack, Input,
  NumberInput, NumberInputField, Select, Stack, Switch, Text as ChakraText,
} from '@chakra-ui/react';

const emptyFund = accountKey => ({
  accountKey,
  name: '',
  fundType: 'operating',
  allocationMode: 'scheduled',
  allocationCents: 0,
  initialBalanceCents: 0,
  periodType: 'weekly',
  weeklyStartDay: 1,
  anchorMonth: 1,
  anchorDay: 1,
  rolloverMode: 'none',
  rolloverCapCents: null,
  targetCents: null,
  householdVisible: false,
  active: true,
  categoryIds: [],
});

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const OperationalFundForm = ({ accountKey, categories, fund, onSave, onCancel, saving }) => {
  const [value, setValue] = useState(emptyFund(accountKey));

  useEffect(() => setValue(fund ? { ...fund } : emptyFund(accountKey)), [fund, accountKey]);

  const set = (key, nextValue) => setValue(current => ({ ...current, [key]: nextValue }));
  const dollars = cents => cents == null ? '' : cents / 100;
  const cents = amount => amount === '' || !Number.isFinite(Number(amount)) ? null : Math.round(Number(amount) * 100);

  const handleSubmit = event => {
    event.preventDefault();
    onSave(value);
  };

  const setFundType = fundType => setValue(current => {
    if (fundType === 'reserved') {
      return {
        ...current,
        fundType,
        allocationMode: 'manual',
        periodType: 'all-time',
        rolloverMode: 'none',
        rolloverCapCents: null,
        initialBalanceCents: 0,
      };
    }
    if (fundType === 'sinking') {
      return {
        ...current,
        fundType,
        allocationMode: 'scheduled',
        periodType: current.periodType === 'all-time' ? 'monthly' : current.periodType,
        rolloverMode: 'full',
        rolloverCapCents: null,
      };
    }
    return {
      ...current,
      fundType,
      allocationMode: 'scheduled',
      periodType: current.periodType === 'all-time' ? 'weekly' : current.periodType,
      rolloverMode: 'none',
      rolloverCapCents: null,
      initialBalanceCents: 0,
      targetCents: null,
    };
  });

  const setSinkingAutoAllocation = enabled => setValue(current => ({
    ...current,
    allocationMode: enabled ? 'scheduled' : 'manual',
    periodType: enabled ? (current.periodType === 'all-time' ? 'monthly' : current.periodType) : 'all-time',
    rolloverMode: enabled ? 'full' : 'none',
  }));

  const showPeriod = value.fundType === 'operating' || (value.fundType === 'sinking' && value.allocationMode === 'scheduled');

  return (
    <Box as="form" onSubmit={handleSubmit}>
      <Stack spacing={4}>
        <FormControl isRequired>
          <FormLabel>Name</FormLabel>
          <Input value={value.name} onChange={event => set('name', event.target.value)} />
        </FormControl>
        <FormControl isRequired>
          <FormLabel>Type</FormLabel>
          <Select value={value.fundType} onChange={event => setFundType(event.target.value)}>
            <option value="operating">Operating</option>
            <option value="reserved">Reserved</option>
            <option value="sinking">Sinking</option>
          </Select>
        </FormControl>

        {value.fundType === 'operating' && (
          <FormControl isRequired>
            <FormLabel>Allocation per Period</FormLabel>
            <NumberInput min={0} precision={2} value={dollars(value.allocationCents)} onChange={amount => set('allocationCents', cents(amount) ?? 0)}>
              <NumberInputField />
            </NumberInput>
          </FormControl>
        )}

        {value.fundType === 'reserved' && (
          <HStack align="start">
            <FormControl isRequired>
              <FormLabel>Reserved Amount</FormLabel>
              <NumberInput min={0} precision={2} value={dollars(value.allocationCents)} onChange={amount => set('allocationCents', cents(amount) ?? 0)}>
                <NumberInputField />
              </NumberInput>
            </FormControl>
            <FormControl>
              <FormLabel>Optional Goal</FormLabel>
              <NumberInput min={0} precision={2} value={dollars(value.targetCents)} onChange={amount => set('targetCents', cents(amount))}>
                <NumberInputField />
              </NumberInput>
            </FormControl>
          </HStack>
        )}

        {value.fundType === 'sinking' && (
          <Stack spacing={4}>
            <HStack align="start">
              <FormControl isRequired>
                <FormLabel>Initial Balance</FormLabel>
                <NumberInput min={0} precision={2} value={dollars(value.initialBalanceCents)} onChange={amount => set('initialBalanceCents', cents(amount) ?? 0)}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
              <FormControl>
                <FormLabel>Optional Goal</FormLabel>
                <NumberInput min={0} precision={2} value={dollars(value.targetCents)} onChange={amount => set('targetCents', cents(amount))}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
            </HStack>
            <FormControl display="flex" alignItems="center">
              <FormLabel mb="0">Automatic Allocation</FormLabel>
              <Switch isChecked={value.allocationMode === 'scheduled'} onChange={event => setSinkingAutoAllocation(event.target.checked)} />
            </FormControl>
            {value.allocationMode === 'scheduled' && (
              <FormControl isRequired>
                <FormLabel>Allocation per Period</FormLabel>
                <NumberInput min={0} precision={2} value={dollars(value.allocationCents)} onChange={amount => set('allocationCents', cents(amount) ?? 0)}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
            )}
          </Stack>
        )}

        {showPeriod && (
          <FormControl>
            <FormLabel>Allocation Period</FormLabel>
            <Select value={value.periodType} onChange={event => set('periodType', event.target.value)}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </FormControl>
        )}
        {showPeriod && value.periodType === 'weekly' && (
          <FormControl>
            <FormLabel>Starting Weekday</FormLabel>
            <Select value={value.weeklyStartDay} onChange={event => set('weeklyStartDay', Number(event.target.value))}>
              {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </Select>
          </FormControl>
        )}
        {showPeriod && ['monthly', 'quarterly', 'yearly'].includes(value.periodType) && (
          <HStack align="start">
            {['quarterly', 'yearly'].includes(value.periodType) && (
              <FormControl>
                <FormLabel>Anchor Month</FormLabel>
                <Select value={value.anchorMonth} onChange={event => set('anchorMonth', Number(event.target.value))}>
                  {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </Select>
              </FormControl>
            )}
            <FormControl>
              <FormLabel>Anchor Day</FormLabel>
              <NumberInput min={1} max={31} value={value.anchorDay} onChange={(_, number) => set('anchorDay', number || 1)}>
                <NumberInputField />
              </NumberInput>
            </FormControl>
          </HStack>
        )}
        {value.fundType === 'operating' && (
          <HStack align="start">
            <FormControl>
              <FormLabel>Rollover</FormLabel>
              <Select value={value.rolloverMode} onChange={event => set('rolloverMode', event.target.value)}>
                <option value="none">No rollover</option>
                <option value="full">Full rollover</option>
                <option value="capped">Capped rollover</option>
              </Select>
            </FormControl>
            {value.rolloverMode === 'capped' && (
              <FormControl>
                <FormLabel>Rollover Cap</FormLabel>
                <NumberInput min={0} precision={2} value={dollars(value.rolloverCapCents)} onChange={amount => set('rolloverCapCents', cents(amount) ?? 0)}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
            )}
          </HStack>
        )}
        <FormControl>
          <FormLabel>Lunch Money Categories</FormLabel>
          <Box maxH="190px" overflowY="auto" borderWidth="1px" borderRadius="md" p={3}>
            <CheckboxGroup value={value.categoryIds.map(String)} onChange={ids => set('categoryIds', ids.map(Number))}>
              <Stack spacing={2}>
                {categories.filter(category => !category.archived).map(category => (
                  <Checkbox key={category.id} value={String(category.id)}>
                    {category.groupName ? `${category.groupName}: ` : ''}{category.name}
                  </Checkbox>
                ))}
              </Stack>
            </CheckboxGroup>
          </Box>
          <ChakraText fontSize="xs" color="gray.500" mt={1}>Categories are optional for Reserved and Sinking Funds.</ChakraText>
        </FormControl>
        <HStack spacing={8}>
          <FormControl display="flex" alignItems="center">
            <FormLabel mb="0">Visible to Household</FormLabel>
            <Switch isChecked={value.householdVisible} onChange={event => set('householdVisible', event.target.checked)} />
          </FormControl>
          <FormControl display="flex" alignItems="center">
            <FormLabel mb="0">Active</FormLabel>
            <Switch isChecked={value.active} onChange={event => set('active', event.target.checked)} />
          </FormControl>
        </HStack>
        <HStack justify="flex-end">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" colorScheme="blue" isLoading={saving}>{fund ? 'Save Changes' : 'Create Allocation'}</Button>
        </HStack>
      </Stack>
    </Box>
  );
};

export default OperationalFundForm;
