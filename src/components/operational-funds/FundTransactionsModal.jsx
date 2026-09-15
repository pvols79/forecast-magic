import {
  Badge, Box, Button, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalFooter, ModalHeader, ModalOverlay, Table, Tbody, Td, Text as ChakraText,
  Th, Thead, Tr,
} from '@chakra-ui/react';
import { formatCurrency } from '../../utils';

const transactionStatus = transaction => {
  if (transaction.excluded) return { label: 'Excluded', colorScheme: 'gray' };
  if (transaction.amount > 0) return { label: 'Refund', colorScheme: 'blue' };
  if (transaction.overBudgetCents > 0) return { label: 'Over budget', colorScheme: 'red' };
  return { label: 'Covered', colorScheme: 'green' };
};

const FundTransactionsModal = ({ isOpen, onClose, fund, canManageExclusions = false, onToggleExclusion }) => (
  <Modal isOpen={isOpen} onClose={onClose} size="4xl">
    <ModalOverlay />
    <ModalContent>
      <ModalHeader>{fund?.name} Transactions</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        {fund?.allocationMode === 'scheduled' && fund.periodType !== 'all-time' && (
          <Box mb={6} overflowX="auto">
            <ChakraText fontWeight="semibold" mb={2}>Allocation history</ChakraText>
            {fund.allocationHistory?.length ? (
              <Table size="sm">
                <Thead><Tr><Th>Period</Th><Th isNumeric>Period funding</Th><Th isNumeric>Rollover</Th></Tr></Thead>
                <Tbody>
                  {fund.allocationHistory.map(period => (
                    <Tr key={period.periodStart}>
                      <Td whiteSpace="nowrap">{period.periodStart} – {period.periodEnd}</Td>
                      <Td isNumeric>{formatCurrency(period.allocationCents / 100)}</Td>
                      <Td isNumeric>{formatCurrency(period.carryInCents / 100)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : <ChakraText>No recorded allocations yet.</ChakraText>}
          </Box>
        )}
        <ChakraText fontSize="sm" color="gray.500" mb={4}>
          Transactions remain visible after the allocation reaches zero so the full period spending is accounted for.
        </ChakraText>
        {!fund?.transactions?.length ? (
          <ChakraText>No qualifying transactions in this period.</ChakraText>
        ) : (
          <Box overflowX="auto">
            <Table size="sm">
              <Thead>
                <Tr>
                  <Th>Date</Th>
                  <Th>Payee</Th>
                  <Th isNumeric>Amount</Th>
                  <Th isNumeric>Covered / restored</Th>
                  <Th isNumeric>Over budget</Th>
                  <Th isNumeric>Remaining</Th>
                  <Th>Status</Th>
                  {canManageExclusions && <Th />}
                </Tr>
              </Thead>
              <Tbody>
                {fund.transactions.map(transaction => {
                  const status = transactionStatus(transaction);
                  return (
                    <Tr key={transaction.transactionId} opacity={transaction.excluded ? 0.6 : 1}>
                      <Td whiteSpace="nowrap">{transaction.date}</Td>
                      <Td>{transaction.description}</Td>
                      <Td isNumeric>{transaction.amount > 0 ? '+' : ''}{formatCurrency(transaction.amount)}</Td>
                      <Td isNumeric>{transaction.excluded ? '-' : formatCurrency((transaction.amount > 0 ? transaction.restoredCents : transaction.coveredCents) / 100)}</Td>
                      <Td isNumeric color={transaction.overBudgetCents > 0 ? 'red.500' : undefined}>
                        {transaction.excluded ? '-' : formatCurrency(transaction.overBudgetCents / 100)}
                      </Td>
                      <Td isNumeric>{formatCurrency(transaction.remainingAfterCents / 100)}</Td>
                      <Td><Badge colorScheme={status.colorScheme}>{status.label}</Badge></Td>
                      {canManageExclusions && (
                        <Td textAlign="right">
                          <Button size="xs" onClick={() => onToggleExclusion(transaction)}>
                            {transaction.excluded ? 'Re-include' : 'Exclude'}
                          </Button>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Box>
        )}
      </ModalBody>
      <ModalFooter><Button onClick={onClose}>Close</Button></ModalFooter>
    </ModalContent>
  </Modal>
);

export default FundTransactionsModal;
