import { useState } from 'react';
import {
  Badge, Box, Heading, HStack, IconButton, Progress, SimpleGrid,
  Text as ChakraText, useColorModeValue, useDisclosure,
} from '@chakra-ui/react';
import { FaReceipt } from 'react-icons/fa';
import { formatCurrency } from '../utils';
import FundTransactionsModal from './operational-funds/FundTransactionsModal';

const typeLabel = fund => ({ operating: 'Operating', reserved: 'Reserved', sinking: 'Sinking' })[fund.fundType] || 'Operating';
const typeColor = fund => ({ operating: 'blue', reserved: 'purple', sinking: 'green' })[fund.fundType] || 'blue';

const HouseholdFundSummaries = ({ funds }) => {
  const bg = useColorModeValue('white', 'gray.700');
  const itemBg = useColorModeValue('gray.50', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.600');
  const [transactionFund, setTransactionFund] = useState(null);
  const transactionsModal = useDisclosure();
  if (!funds?.length) return null;

  return (
    <Box bg={bg} borderRadius="md" borderWidth="1px" boxShadow="sm" p={{ base: 4, lg: 5 }}>
      <Heading size="md" mb={3}>Fund Allocations</Heading>
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={3}>
        {funds.map(fund => {
          const progress = fund.targetCents ? Math.min(100, fund.remainingCents / fund.targetCents * 100) : null;
          return (
            <Box key={fund.id} bg={itemBg} borderRadius="md" borderWidth="1px" borderColor={borderColor} p={3}>
              <HStack justify="space-between" align="start">
                <Box>
                  <ChakraText fontWeight="bold" lineHeight="short">{fund.name}</ChakraText>
                  <Badge mt={1} colorScheme={typeColor(fund)}>{typeLabel(fund)}</Badge>
                </Box>
                <IconButton
                  aria-label={`View ${fund.name} transactions`}
                  icon={<FaReceipt />}
                  size="sm"
                  onClick={() => { setTransactionFund(fund); transactionsModal.onOpen(); }}
                />
              </HStack>
              <ChakraText fontSize="lg" fontWeight="semibold" mt={1}>{formatCurrency(fund.remainingCents / 100)}</ChakraText>
              <ChakraText fontSize="xs" color="gray.500">Available</ChakraText>
              {fund.targetCents != null && (
                <>
                  <ChakraText mt={2} fontSize="xs" color="gray.500">{formatCurrency(fund.targetCents / 100)} target</ChakraText>
                  <Progress mt={1} value={progress} colorScheme="green" size="sm" />
                </>
              )}
            </Box>
          );
        })}
      </SimpleGrid>
      <FundTransactionsModal
        isOpen={transactionsModal.isOpen}
        onClose={transactionsModal.onClose}
        fund={transactionFund}
      />
    </Box>
  );
};

export default HouseholdFundSummaries;
