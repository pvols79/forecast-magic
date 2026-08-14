import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Heading, HStack, IconButton, Progress,
  Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay,
  SimpleGrid, Spinner, Text as ChakraText,
  useColorModeValue, useDisclosure, VStack,
} from '@chakra-ui/react';
import { FaEdit, FaPlus, FaReceipt, FaTrash } from 'react-icons/fa';
import { formatCurrency } from '../../utils';
import {
  createOperationalFund, deleteOperationalFund, excludeFundTransaction,
  getApiErrorMessage, getCategories, getOperationalFunds, includeFundTransaction,
  updateOperationalFund,
} from '../../backendApi';
import OperationalFundForm from './OperationalFundForm';
import FundTransactionsModal from './FundTransactionsModal';

const typeLabel = fund => ({ operating: 'Operating', reserved: 'Reserved', sinking: 'Sinking' })[fund.fundType] || 'Operating';
const typeColor = fund => ({ operating: 'blue', reserved: 'purple', sinking: 'green' })[fund.fundType] || 'blue';
const capitalize = value => `${value[0].toUpperCase()}${value.slice(1)}`;
const periodLabel = fund => {
  if (fund.fundType === 'reserved') return 'All-time reservation';
  if (fund.fundType === 'sinking' && fund.allocationMode === 'manual') return 'Manual balance';
  if (fund.fundType === 'sinking') return `${capitalize(fund.periodType)} auto allocation / full rollover`;
  return `${capitalize(fund.periodType)} auto allocation / ${fund.rolloverMode} rollover`;
};

const OperationalFundsManager = ({ accountKey, currentStates, onChanged }) => {
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editingFund, setEditingFund] = useState(null);
  const [transactionFund, setTransactionFund] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const formModal = useDisclosure();
  const transactionsModal = useDisclosure();
  const bg = useColorModeValue('white', 'gray.700');
  const itemBg = useColorModeValue('gray.50', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.600');

  const load = useCallback(async () => {
    if (!accountKey) return;
    setLoading(true);
    setError('');
    try {
      const [nextFunds, nextCategories] = await Promise.all([
        getOperationalFunds(accountKey),
        getCategories(),
      ]);
      setFunds(nextFunds);
      setCategories(nextCategories);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => { load(); }, [load]);

  const statesById = useMemo(() => new Map((currentStates || []).map(state => [state.id, state])), [currentStates]);

  const save = async value => {
    setSaving(true);
    setError('');
    try {
      if (editingFund) await updateOperationalFund(editingFund.id, value);
      else await createOperationalFund(value);
      formModal.onClose();
      setEditingFund(null);
      await load();
      onChanged();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async fund => {
    if (!window.confirm(`Delete ${fund.name}?`)) return;
    try {
      await deleteOperationalFund(fund.id);
      await load();
      onChanged();
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError));
    }
  };

  const showTransactions = fund => {
    setTransactionFund(fund);
    transactionsModal.onOpen();
  };

  const toggleExclusion = async transaction => {
    try {
      if (transaction.excluded) await includeFundTransaction(transactionFund.id, transaction.transactionId);
      else await excludeFundTransaction(transactionFund.id, transaction.transactionId);
      onChanged();
    } catch (transactionError) {
      setError(getApiErrorMessage(transactionError));
    }
  };

  const transactionState = transactionFund ? statesById.get(transactionFund.id) : null;

  return (
    <Box bg={bg} borderRadius="md" borderWidth="1px" boxShadow="sm" p={{ base: 4, lg: 5 }}>
      <HStack justify="space-between" mb={3}>
        <Heading size="md">Fund Allocations</Heading>
        <Button size="sm" leftIcon={<FaPlus />} onClick={() => { setEditingFund(null); formModal.onOpen(); }} colorScheme="blue">
          Create Fund
        </Button>
      </HStack>
      {error && <Alert status="error" mb={4}><AlertIcon />{error}</Alert>}
      {loading ? <Spinner /> : funds.length === 0 ? (
        <ChakraText color="gray.500">No Fund Allocations for this account.</ChakraText>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={3}>
          {funds.map(fund => {
            const state = statesById.get(fund.id);
            return (
              <Box
                key={fund.id}
                bg={itemBg}
                borderRadius="md"
                borderWidth="1px"
                borderColor={borderColor}
                p={3}
                opacity={fund.active ? 1 : 0.65}
              >
                <HStack justify="space-between" align="start">
                  <Box>
                    <HStack>
                      <Heading size="sm">{fund.name}</Heading>
                      <Badge colorScheme={typeColor(fund)}>{typeLabel(fund)}</Badge>
                      {!fund.active && <Badge>Disabled</Badge>}
                      {fund.householdVisible && <Badge colorScheme="green">Household</Badge>}
                    </HStack>
                    <ChakraText fontSize="sm" color="gray.500">{periodLabel(fund)}</ChakraText>
                  </Box>
                  <HStack spacing={1}>
                    <IconButton aria-label={`View ${fund.name} transactions`} icon={<FaReceipt />} size="sm" onClick={() => showTransactions(fund)} />
                    <IconButton aria-label={`Edit ${fund.name}`} icon={<FaEdit />} size="sm" onClick={() => { setEditingFund(fund); formModal.onOpen(); }} />
                    <IconButton aria-label={`Delete ${fund.name}`} icon={<FaTrash />} size="sm" colorScheme="red" onClick={() => remove(fund)} />
                  </HStack>
                </HStack>
                <HStack mt={3} pt={3} borderTopWidth="1px" borderColor={borderColor} justify="space-between" align="end">
                  <Box>
                    <ChakraText fontSize="xs" color="gray.500">Remaining</ChakraText>
                    <ChakraText fontSize="lg" lineHeight="short" fontWeight="bold">
                      {formatCurrency((state?.remainingCents ?? fund.allocationCents) / 100)}
                    </ChakraText>
                  </Box>
                  <Box textAlign="right">
                    <ChakraText fontSize="xs" color="gray.500">
                      {fund.fundType === 'reserved' ? 'Reserved amount' : fund.allocationMode === 'manual' ? 'Initial balance' : 'Auto allocation'}
                    </ChakraText>
                    <ChakraText fontWeight="semibold">
                      {formatCurrency((fund.fundType === 'sinking' && fund.allocationMode === 'manual' ? fund.initialBalanceCents : fund.allocationCents) / 100)}
                    </ChakraText>
                  </Box>
                </HStack>
                {fund.targetCents != null && (
                  <Box mt={3}>
                    <HStack justify="space-between" fontSize="xs" color="gray.500">
                      <ChakraText>Goal progress</ChakraText>
                      <ChakraText>{formatCurrency(fund.targetCents / 100)}</ChakraText>
                    </HStack>
                    <Progress mt={1} size="sm" colorScheme="green" value={fund.targetCents > 0 ? Math.min(100, (state?.remainingCents || 0) / fund.targetCents * 100) : 100} />
                  </Box>
                )}
              </Box>
            );
          })}
        </SimpleGrid>
      )}

      <Modal isOpen={formModal.isOpen} onClose={formModal.onClose} size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{editingFund ? 'Edit Fund Allocation' : 'Create Fund Allocation'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <OperationalFundForm
              accountKey={accountKey}
              categories={categories}
              fund={editingFund}
              onSave={save}
              onCancel={formModal.onClose}
              saving={saving}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      <FundTransactionsModal
        isOpen={transactionsModal.isOpen}
        onClose={transactionsModal.onClose}
        fund={transactionState}
        canManageExclusions
        onToggleExclusion={toggleExclusion}
      />
    </Box>
  );
};

export default OperationalFundsManager;
