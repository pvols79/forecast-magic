import { useEffect, useState } from 'react';
import { Alert, AlertIcon, Badge, Box, Button, Heading, HStack, Select, Spinner, Table, Tbody, Td, Text, Th, Thead, Tr, useColorModeValue } from '@chakra-ui/react';
import { getApiErrorMessage, getFundAllocationHistory } from '../../backendApi';
import { addDays } from '../../../server/domain/periods';
import { formatCurrency } from '../../utils';

const AllocationHistory = ({ accountKey, revision, currentStates, onRemove, saving }) => {
  const [history, setHistory] = useState(null);
  const [range, setRange] = useState('30');
  const [error, setError] = useState('');
  const bg = useColorModeValue('white', 'gray.700');
  useEffect(() => {
    let stale = false;
    setHistory(null); setError('');
    getFundAllocationHistory(accountKey).then(value => { if (!stale) setHistory(value); })
      .catch(err => { if (!stale) setError(getApiErrorMessage(err)); });
    return () => { stale = true; };
  }, [accountKey, revision, currentStates]);
  const start = history && range !== 'all' ? addDays(history.throughDate, -(Number(range) - 1)) : null;
  const rows = (history?.rows || []).filter(row => !start || row.date >= start);
  return <Box bg={bg} borderWidth="1px" borderRadius="md" p={{ base: 4, lg: 5 }} mt={5}>
    <HStack justify="space-between" flexWrap="wrap" gap={3}>
      <Box><Heading size="md">Auto-allocation history</Heading><Text fontSize="sm" color="gray.500">All funds and sub-funds in this account · newest first</Text></Box>
      <Select aria-label="Auto-allocation history range" w="auto" value={range} onChange={event => setRange(event.target.value)}>
        <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="all">All history</option>
      </Select>
    </HStack>
    {error ? <Alert status="error" mt={3}><AlertIcon />{error}</Alert> : !history ? <Spinner mt={3} /> : !rows.length ? <Text mt={4} color="gray.500">No automatic allocations in this range.</Text> :
      <Box overflow="auto" maxH="320px" mt={4}><Table size="sm"><Thead position="sticky" top={0} bg={bg} zIndex={1}><Tr><Th>Date</Th><Th>Fund / sub-fund</Th><Th>Status</Th><Th isNumeric>Amount</Th><Th /></Tr></Thead><Tbody>
        {rows.map(row => <Tr key={`${row.fundId}:${row.periodStart}`} opacity={row.removed ? 0.55 : 1}><Td whiteSpace="nowrap">{row.date}</Td><Td>{row.parentName ? `${row.parentName} → ` : ''}{row.fundName}</Td><Td><Badge>{row.removed ? 'Removed' : row.amount === 0 ? 'No contribution' : 'Posted'}</Badge>{row.archived && <Badge ml={1}>Archived fund</Badge>}</Td><Td isNumeric textDecoration={row.removed ? 'line-through' : undefined}>{formatCurrency(row.amount)}</Td><Td>{!row.removed && !row.archived && <Button size="xs" colorScheme="red" variant="outline" isDisabled={saving} onClick={() => onRemove({ ...row, subFundName: row.fundName })}>Remove allocation</Button>}</Td></Tr>)}
      </Tbody></Table></Box>}
    <Text fontSize="xs" color="gray.500" mt={3}>Recorded allocations only. Removed entries stay visible for history; future scheduled allocations appear in Forecast Detail.</Text>
  </Box>;
};
export default AllocationHistory;
