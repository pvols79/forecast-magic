import { FormControl, FormLabel, Select, useColorModeValue } from '@chakra-ui/react';

const AccountSelector = ({ accounts, onAccountSelect, selectedAccountId }) => {
  const textColor = useColorModeValue('gray.800', 'whiteAlpha.900');
  const bgColor = useColorModeValue('white', 'gray.700');

  return (
    <FormControl w={{ base: '100%', md: '38%' }} minW={{ md: '280px' }}>
      <FormLabel fontSize="sm" fontWeight="semibold" mb={1}>Account</FormLabel>
      <Select
        value={selectedAccountId || ''}
        onChange={(event) => onAccountSelect(event.target.value)}
        size="md"
        bg={bgColor}
        color={textColor}
      >
        {accounts.map(account => (
          <option key={account.key} value={account.key}>
            {account.display_name || account.name}
          </option>
        ))}
      </Select>
    </FormControl>
  );
};

export default AccountSelector;
