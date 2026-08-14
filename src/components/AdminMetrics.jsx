import { Box, SimpleGrid, Stat, StatHelpText, StatLabel, StatNumber, useColorModeValue } from '@chakra-ui/react';
import { formatCurrency } from '../utils';

const formatSignedCurrency = value => `${value >= 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;

const AdminMetrics = ({ openingBalance }) => {
  const bg = useColorModeValue('white', 'gray.700');
  if (!openingBalance) return null;

  return (
    <Box bg={bg} borderRadius="md" borderWidth="1px" boxShadow="sm" px={{ base: 4, lg: 5 }} py={3}>
      <SimpleGrid columns={{ base: 2, md: 3, xl: 6 }} spacing={{ base: 3, lg: 5 }}>
        <Stat>
          <StatLabel>Synced Account Balance</StatLabel>
          <StatNumber fontSize="lg">{formatCurrency(openingBalance.syncedAccountBalance)}</StatNumber>
        </Stat>
        <Stat>
          <StatLabel>Opening Adjustments</StatLabel>
          <StatNumber fontSize="lg">{formatSignedCurrency(openingBalance.adjustmentTotal)}</StatNumber>
          <StatHelpText mb={0}>{openingBalance.adjustmentEvents.length} items</StatHelpText>
        </Stat>
        <Stat>
          <StatLabel>Adjusted Opening Ledger</StatLabel>
          <StatNumber fontSize="lg">{formatCurrency(openingBalance.ledgerBalance)}</StatNumber>
        </Stat>
        <Stat>
          <StatLabel>Today&apos;s Forecast Activity</StatLabel>
          <StatNumber fontSize="lg">{formatSignedCurrency(openingBalance.anchorDateEventTotal)}</StatNumber>
          <StatHelpText mb={0}>{openingBalance.anchorDateEvents.length} items</StatHelpText>
        </Stat>
        <Stat>
          <StatLabel>Fund Allocations Reserved</StatLabel>
          <StatNumber fontSize="lg">-{formatCurrency(openingBalance.reservedOperationalFunds)}</StatNumber>
        </Stat>
        <Stat>
          <StatLabel>Available to Spend</StatLabel>
          <StatNumber fontSize="lg">{formatCurrency(openingBalance.availableToSpend)}</StatNumber>
        </Stat>
      </SimpleGrid>
    </Box>
  );
};

export default AdminMetrics;
