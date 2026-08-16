import { useEffect, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel,
  HStack, Heading, IconButton, ListItem, Modal, ModalBody, ModalCloseButton,
  ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Spinner, Table,
  Tbody, Td, Text as ChakraText, Th, Thead, Tr, UnorderedList, VStack,
  useColorModeValue,
} from '@chakra-ui/react';
import { FaChevronDown, FaChevronUp, FaSearch, FaSyncAlt } from 'react-icons/fa';
import {
  getApiErrorMessage, ignoreDuplicateTransactions, resolveDuplicateTransactions,
  scanDuplicateTransactions,
} from '../backendApi';
import { formatCurrency } from '../utils';

const confidenceScheme = { high: 'green', medium: 'orange', low: 'gray' };

const TransactionDetails = ({ transaction, label }) => (
  <VStack align="stretch" spacing={0.5} minW="200px">
    <HStack spacing={2}>
      <Badge colorScheme={label === 'Manual' ? 'purple' : 'blue'}>{label}</Badge>
      <ChakraText fontSize="xs" color="gray.500">{transaction.date}</ChakraText>
    </HStack>
    <ChakraText fontWeight="semibold">{transaction.payee || 'Unnamed transaction'}</ChakraText>
    <ChakraText fontSize="xs">{transaction.categoryName}</ChakraText>
    <ChakraText fontSize="xs" color="gray.500">
      {transaction.notes ? `Notes: ${transaction.notes}` : 'No notes'}
    </ChakraText>
    <ChakraText fontSize="xs" color="gray.500">
      {transaction.recurringName || 'No recurring relationship'}
    </ChakraText>
    <ChakraText fontSize="xs" color="gray.500">Source: {transaction.source}</ChakraText>
  </VStack>
);

const DuplicateConfirmation = ({ candidate, isOpen, onClose, onConfirm, resolving }) => {
  const [categoryPreference, setCategoryPreference] = useState('manual');
  const [notesPreference, setNotesPreference] = useState('combine');
  const [recurringPreference, setRecurringPreference] = useState('imported');

  useEffect(() => {
    if (!candidate) return;
    setCategoryPreference('manual');
    setNotesPreference('combine');
    setRecurringPreference('imported');
  }, [candidate]);

  if (!candidate) return null;
  const { conflicts } = candidate.mergePreview;
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Confirm Duplicate</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Alert status="warning" mb={4}>
            <AlertIcon />
            This permanently deletes the manual transaction after Lunch Money confirms the imported transaction update.
          </Alert>
          <VStack align="stretch" spacing={3}>
            <Box>
              <ChakraText fontWeight="bold">Keep imported transaction #{candidate.imported.id}</ChakraText>
              <ChakraText fontSize="sm">{candidate.imported.date} · {candidate.imported.payee}</ChakraText>
            </Box>
            <Box>
              <ChakraText fontWeight="bold">Delete manual transaction #{candidate.manual.id}</ChakraText>
              <ChakraText fontSize="sm">{candidate.manual.date} · {candidate.manual.payee}</ChakraText>
            </Box>
            <UnorderedList pl={4} fontSize="sm">
              {candidate.mergePreview.summary.map(item => <ListItem key={item}>{item}</ListItem>)}
            </UnorderedList>

            {conflicts.category && (
              <FormControl>
                <FormLabel fontSize="sm">Category conflict</FormLabel>
                <Select value={categoryPreference} onChange={event => setCategoryPreference(event.target.value)}>
                  <option value="manual">Manual: {candidate.manual.categoryName}</option>
                  <option value="imported">Imported: {candidate.imported.categoryName}</option>
                </Select>
              </FormControl>
            )}
            {conflicts.notes && (
              <FormControl>
                <FormLabel fontSize="sm">Notes conflict</FormLabel>
                <Select value={notesPreference} onChange={event => setNotesPreference(event.target.value)}>
                  <option value="combine">Combine both notes</option>
                  <option value="manual">Keep manual notes only</option>
                  <option value="imported">Keep imported notes only</option>
                </Select>
              </FormControl>
            )}
            {conflicts.recurring && (
              <FormControl>
                <FormLabel fontSize="sm">Recurring relationship conflict</FormLabel>
                <Select value={recurringPreference} onChange={event => setRecurringPreference(event.target.value)}>
                  <option value="imported">Keep imported #{candidate.imported.recurringId}</option>
                  <option value="manual">Use manual #{candidate.manual.recurringId}</option>
                </Select>
              </FormControl>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={onClose} isDisabled={resolving}>Cancel</Button>
          <Button
            colorScheme="red"
            onClick={() => onConfirm({ categoryPreference, notesPreference, recurringPreference })}
            isLoading={resolving}
          >
            Confirm Duplicate
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const DuplicateReview = ({ accountKey, onRefresh }) => {
  const [candidates, setCandidates] = useState([]);
  const [showLow, setShowLow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [message, setMessage] = useState(null);
  const panelBg = useColorModeValue('white', 'gray.700');

  useEffect(() => {
    setCandidates([]);
    setShowLow(false);
    setExpanded(false);
    setHasScanned(false);
    setMessage(null);
  }, [accountKey]);

  const scan = async (includeLow = showLow) => {
    setScanning(true);
    setMessage(null);
    try {
      const result = await scanDuplicateTransactions(accountKey, includeLow);
      setCandidates(result.candidates);
      setHasScanned(true);
      setExpanded(result.candidates.length > 0 || expanded);
      setMessage(result.candidates.length === 0
        ? { status: 'success', text: 'No likely duplicates found in the last 30 days.' }
        : null);
    } catch (error) {
      setMessage({ status: 'error', text: getApiErrorMessage(error) });
      setExpanded(true);
    } finally {
      setScanning(false);
    }
  };

  const handleLowConfidence = async checked => {
    setShowLow(checked);
    if (hasScanned) await scan(checked);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      await onRefresh();
      setMessage({ status: 'success', text: 'Application data refreshed.' });
    } catch (error) {
      setMessage({ status: 'error', text: getApiErrorMessage(error) });
    } finally {
      setRefreshing(false);
    }
  };

  const handleIgnore = async candidate => {
    try {
      await ignoreDuplicateTransactions(candidate);
      setCandidates(current => current.filter(item => item.id !== candidate.id));
      setMessage({ status: 'success', text: 'Pair marked Not Duplicate and ignored for future scans.' });
    } catch (error) {
      setMessage({ status: 'error', text: getApiErrorMessage(error) });
    }
  };

  const handleResolve = async preferences => {
    setResolving(true);
    try {
      await resolveDuplicateTransactions(selectedCandidate, preferences);
      setCandidates(current => current.filter(item => item.id !== selectedCandidate.id));
      setSelectedCandidate(null);
      setMessage({ status: 'success', text: 'Duplicate resolved in Lunch Money.' });
      await onRefresh();
    } catch (error) {
      setMessage({ status: 'error', text: getApiErrorMessage(error) });
    } finally {
      setResolving(false);
    }
  };

  const showSection = expanded || candidates.length > 0;
  return (
    <VStack spacing={3} align="stretch">
      <Flex justify="flex-end" gap={2} wrap="wrap">
        <Button size="sm" leftIcon={<FaSyncAlt />} onClick={handleRefresh} isLoading={refreshing}>Refresh</Button>
        <Button size="sm" leftIcon={<FaSearch />} onClick={() => scan()} isLoading={scanning}>Check for Duplicates</Button>
        <IconButton
          size="sm"
          variant="outline"
          aria-label={expanded ? 'Collapse Duplicate Review' : 'Expand Duplicate Review'}
          icon={expanded ? <FaChevronUp /> : <FaChevronDown />}
          onClick={() => setExpanded(value => !value)}
        />
      </Flex>

      {message && !showSection && (
        <Alert status={message.status} borderRadius="md" py={2}><AlertIcon />{message.text}</Alert>
      )}

      {showSection && (
        <Box bg={panelBg} borderRadius="md" borderWidth="1px" boxShadow="sm" overflow="hidden">
          <Flex px={{ base: 4, lg: 5 }} py={3} justify="space-between" align="center" gap={3} wrap="wrap">
            <Box>
              <Heading size="sm">Duplicate Review</Heading>
              <ChakraText fontSize="xs" color="gray.500">
                Suggestions use account, amount, date, payee, category, recurring relationship, and transaction source.
                Confirming Duplicate updates the imported transaction and permanently deletes the manual transaction.
              </ChakraText>
            </Box>
            <Checkbox isChecked={showLow} onChange={event => handleLowConfidence(event.target.checked)} size="sm">
              Show low-confidence matches
            </Checkbox>
          </Flex>
          {message && <Alert status={message.status} mx={4} mb={3} py={2}><AlertIcon />{message.text}</Alert>}
          {scanning ? (
            <Flex justify="center" p={6}><Spinner /></Flex>
          ) : candidates.length > 0 ? (
            <Box overflowX="auto">
              <Table size="sm">
                <Thead>
                  <Tr>
                    <Th>Confidence</Th>
                    <Th>Manual transaction</Th>
                    <Th>Imported transaction</Th>
                    <Th isNumeric>Amount</Th>
                    <Th>Why matched</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {candidates.map(candidate => (
                    <Tr key={candidate.id}>
                      <Td><Badge colorScheme={confidenceScheme[candidate.confidence]}>{candidate.confidence}</Badge></Td>
                      <Td><TransactionDetails transaction={candidate.manual} label="Manual" /></Td>
                      <Td><TransactionDetails transaction={candidate.imported} label="Imported" /></Td>
                      <Td isNumeric whiteSpace="nowrap" color={candidate.manual.amount >= 0 ? 'green.500' : 'red.500'}>
                        {formatCurrency(candidate.manual.amount)}
                      </Td>
                      <Td minW="160px">
                        <Flex gap={1} wrap="wrap">
                          {candidate.reasons.map(reason => <Badge key={reason} variant="subtle">{reason}</Badge>)}
                        </Flex>
                      </Td>
                      <Td>
                        <VStack align="stretch" spacing={2} minW="130px">
                          <Button size="xs" colorScheme="red" onClick={() => setSelectedCandidate(candidate)}>Duplicate</Button>
                          <Button size="xs" variant="outline" onClick={() => handleIgnore(candidate)}>Not Duplicate</Button>
                        </VStack>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          ) : hasScanned ? null : (
            <ChakraText px={5} pb={4} fontSize="sm" color="gray.500">
              Run Check for Duplicates to scan the selected account&apos;s last 30 days.
            </ChakraText>
          )}
        </Box>
      )}

      <DuplicateConfirmation
        candidate={selectedCandidate}
        isOpen={Boolean(selectedCandidate)}
        onClose={() => !resolving && setSelectedCandidate(null)}
        onConfirm={handleResolve}
        resolving={resolving}
      />
    </VStack>
  );
};

export default DuplicateReview;
