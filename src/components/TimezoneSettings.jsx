import { FormControl, FormLabel, Select } from '@chakra-ui/react';

const timezoneOptions = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : ['UTC', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/New_York'];

const TimezoneSettings = ({ timezone, onChange }) => (
  <FormControl maxW="360px">
    <FormLabel>Application Timezone</FormLabel>
    <Select value={timezone || ''} onChange={event => onChange(event.target.value)}>
      {timezoneOptions.map(option => <option key={option} value={option}>{option}</option>)}
    </Select>
  </FormControl>
);

export default TimezoneSettings;
