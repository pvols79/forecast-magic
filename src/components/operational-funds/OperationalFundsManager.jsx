import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Drawer, DrawerBody, DrawerCloseButton,
  DrawerContent, DrawerHeader, DrawerOverlay, FormControl, FormLabel, Heading,
  HStack, Input, Select, SimpleGrid, Spinner, Table, Tbody, Td, Text, Th, Thead,
  Tr, useColorModeValue, useDisclosure, VStack,
} from '@chakra-ui/react';
import { FaPlus } from 'react-icons/fa';
import { formatCurrency } from '../../utils';
import {
  archiveOperationalFund, restoreOperationalFund, addFundAdjustment, createOperationalFund, deleteOperationalFund, excludeFundTransaction,
  getApiErrorMessage, getCategories, getFundRegister, getOperationalFunds,
  includeFundTransaction, updateOperationalFund,
} from '../../backendApi';
import OperationalFundForm from './OperationalFundForm';

const money = cents => formatCurrency((cents || 0) / 100);
const OperationalFundsManager = ({ accountKey, currentStates, onChanged, compact = false, onOpenFunds, initialSelectedId = null }) => {
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [editingFund, setEditingFund] = useState(null);
  const [register, setRegister] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [scope, setScope] = useState('period');
  const [childFilter, setChildFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [adjustment, setAdjustment] = useState({ amount: '', note: '', fundId: '', transferToId: '' });
  const form = useDisclosure();
  const adjust = useDisclosure();
  const bg = useColorModeValue('white', 'gray.700');
  const mutedBg = useColorModeValue('gray.50', 'gray.800');
  const load = useCallback(async () => {
    if (!accountKey) return;
    setLoading(true);
    try {
      const [nextFunds, nextCategories] = await Promise.all([getOperationalFunds(accountKey), getCategories()]);
      setFunds(nextFunds); setCategories(nextCategories);

    } catch (err) { setError(getApiErrorMessage(err)); }
    finally { setLoading(false); }
  }, [accountKey]);
  useEffect(() => { setError(''); setChildFilter(''); load(); }, [load]);
  const states = useMemo(() => new Map((currentStates || []).flatMap(state => [state, ...(state.children || [])]).map(state => [state.id, state])), [currentStates]);
  const selected = funds.find(fund => fund.id === selectedId);
  const state = selected?.archivedAt ? { remainingCents: selected.archivedRemainingCents,
    ownRemainingCents: (selected.archivedRemainingCents || 0) - funds.filter(child => child.archivedWithParentId === selectedId).reduce((sum, child) => sum + (child.archivedRemainingCents || 0), 0),
    periodStart: selected.createdOn } : states.get(selectedId);
  const children = funds.filter(fund => fund.parentId === selectedId && Boolean(fund.archivedAt) === showArchived);
  const members = selected ? [selected, ...children] : [];
  useEffect(() => {
    if (!selectedId || compact) return;
    let stale = false;
    setRegisterLoading(true);
    getFundRegister(selectedId).then(rows => { if (!stale) setRegister(rows); })
      .catch(err => { if (!stale) { setError(getApiErrorMessage(err)); setRegister([]); } })
      .finally(() => { if (!stale) setRegisterLoading(false); });
    return () => { stale = true; };
  }, [selectedId, revision, currentStates, compact]);
  const changed = async () => { await load(); setRevision(v => v + 1); onChanged(); };
  const save = async value => {
    setSaving(true); setError('');
    try {
      if (editingFund?.id) await updateOperationalFund(editingFund.id, value);
      else await createOperationalFund(value);
      form.onClose(); await changed();
    } catch (err) { setError(getApiErrorMessage(err)); }
    finally { setSaving(false); }
  };
  const edit = fund => { setEditingFund(fund); form.onOpen(); };
  const addChild = () => edit({ accountKey, name: '', parentId: selectedId, fundType: 'sinking', allocationMode: 'manual', initialBalanceCents: 0, allocationCents: 0, periodType: 'all-time', rolloverMode: 'full', categoryIds: [], householdVisible: selected.householdVisible, active: true });
  const setArchive = async fund => {
    if (!fund.archivedAt && !window.confirm(`Archive ${fund.name}${fund.parentId ? '' : ' and its sub-funds'}? Its remaining reservation will be released to available-to-spend. History will be kept. Move the remaining money first if you want another fund to hold it.`)) return;
    setSaving(true); setError('');
    try {
      if (fund.archivedAt) await restoreOperationalFund(fund.id);
      else await archiveOperationalFund(fund.id);
      form.onClose(); await changed();
    } catch (err) { setError(getApiErrorMessage(err)); }
    finally { setSaving(false); }
  };
  const remove = async fund => {
    if (!window.confirm(`Delete ${fund.name} permanently, including its settings and local history? Any remaining reservation will become available to spend. Lunch Money transactions will remain. Archive instead to preserve history.`)) return;
    setError('');
    try { await deleteOperationalFund(fund.id); await changed(); form.onClose(); }
    catch (err) { setError(getApiErrorMessage(err)); }
  };
  const toggleExclusion = async row => {
    setError('');
    try {
      if (row.excluded) await includeFundTransaction(row.fundId, row.transactionId);
      else await excludeFundTransaction(row.fundId, row.transactionId);
      await changed();
    } catch (err) { setError(getApiErrorMessage(err)); }
  };
  const saveAdjustment = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await addFundAdjustment(Number(adjustment.fundId), {
        amountCents: Math.round(Number(adjustment.amount) * 100), note: adjustment.note,
        ...(adjustment.transferToId ? { transferToId: Number(adjustment.transferToId) } : {}),
      });
      adjust.onClose(); await changed();
    } catch (err) { setError(getApiErrorMessage(err)); }
    finally { setSaving(false); }
  };
  const rows = register.filter(row => (!childFilter || String(row.fundId) === childFilter) && (scope === 'all' || !state?.periodStart || row.date >= state.periodStart));
  const roots = useMemo(() => funds.filter(fund => Boolean(fund.archivedAt) === showArchived && (!fund.parentId || (showArchived && !funds.find(parent => parent.id === fund.parentId)?.archivedAt))), [funds, showArchived]);
  useEffect(() => {
    setSelectedId(current => roots.some(fund => fund.id === current) ? current : roots[0]?.id || null);
    setChildFilter('');
  }, [roots]);
  return (
    <Box bg={bg} borderRadius="md" borderWidth="1px" p={{ base: 4, lg: 5 }} minH={compact ? undefined : '65vh'}>
      <HStack justify="space-between" mb={4} flexWrap="wrap" gap={2}>
        <Box><Heading size="md">{compact ? 'Fund Allocations' : 'Funds'}</Heading>
          {!compact && <Text color="gray.500" fontSize="sm">Plan the occasion. Track the spending. Keep the history.</Text>}
        </Box>
        <HStack>{!compact && <Button variant="outline" onClick={() => setShowArchived(value => !value)}>{showArchived ? 'View current funds' : 'View archived funds'}</Button>}{compact && <Button onClick={() => onOpenFunds?.()}>Open Funds</Button>}<Button colorScheme="blue" leftIcon={<FaPlus />} onClick={() => edit(null)}>Create Fund</Button></HStack>
      </HStack>
      {error && <Alert status="error" mb={4}><AlertIcon />{error}</Alert>}
      {loading ? <Spinner /> : roots.length === 0 ? <Text color="gray.500">{showArchived ? 'No archived funds.' : 'Create a fund to start reserving money.'}</Text> : <>
        <Box overflowX="auto" maxH={compact ? undefined : '230px'} mb={5}>
          <Table size="sm" variant="simple">
            <Thead position="sticky" top={0} bg={bg} zIndex={1}><Tr><Th>Fund</Th><Th>Type</Th><Th isNumeric>{showArchived ? 'Balance at archive' : 'Remaining / reserved'}</Th><Th isNumeric>Goal</Th><Th>Sub-funds</Th></Tr></Thead>
            <Tbody>{roots.map(fund => <Tr key={fund.id} bg={!compact && selectedId === fund.id ? mutedBg : undefined} opacity={fund.active ? 1 : 0.6}>
              <Td><Button variant="link" onClick={() => { setSelectedId(fund.id); setChildFilter(''); if (compact) onOpenFunds?.(fund.id); }}>{fund.name}</Button>{!fund.active && <Badge ml={2}>{fund.archivedAt ? 'Archived' : 'Disabled'}</Badge>}</Td>
              <Td textTransform="capitalize">{fund.fundType}</Td><Td isNumeric fontWeight="bold">{money(fund.archivedAt ? fund.archivedRemainingCents : states.get(fund.id)?.remainingCents)}</Td><Td isNumeric>{fund.targetCents == null ? '—' : money(fund.targetCents)}</Td><Td>{funds.filter(child => child.parentId === fund.id && Boolean(child.archivedAt) === showArchived).length || '—'}</Td>
            </Tr>)}</Tbody>
          </Table>
        </Box>
        {!compact && selected && <VStack align="stretch" spacing={5}>
          <HStack justify="space-between" flexWrap="wrap" gap={2}>
            <Box><Heading size="md">{selected.name}</Heading><Text fontSize="sm" color="gray.500">{state?.periodEnd ? `${state.periodStart} – ${state.periodEnd}` : `Since ${selected.createdOn}`}</Text></Box>
            <HStack flexWrap="wrap"><Button size="sm" isDisabled={Boolean(selected.archivedAt)} onClick={addChild}>Add sub-fund</Button><Button size="sm" isDisabled={Boolean(selected.archivedAt) || !members.some(member => member.fundType !== 'operating')} onClick={() => { setAdjustment({ amount: '', note: '', fundId: String(members.find(member => member.fundType !== 'operating')?.id || ''), transferToId: '' }); adjust.onOpen(); }}>Adjust / move money</Button><Button size="sm" variant="outline" onClick={() => edit(selected)}>Fund settings</Button></HStack>
          </HStack>
          {selected.archivedAt && <Alert status="info"><AlertIcon />Archived {selected.archivedOn}. This balance is a historical snapshot and is no longer reserved. Restoring recalculates the balance using current categories and schedules.</Alert>}
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
            <Box p={4} bg={mutedBg} borderRadius="md"><Text fontSize="sm" color="gray.500">{selected.archivedAt ? 'Balance at archive' : 'Total reserved'}</Text><Text fontSize="2xl" fontWeight="bold">{money(state?.remainingCents)}</Text></Box>
            <Box p={4} bg={mutedBg} borderRadius="md"><Text fontSize="sm" color="gray.500">{children.length ? 'Unassigned in parent' : 'Opening balance'}</Text><Text fontSize="2xl" fontWeight="bold">{money(children.length ? state?.ownRemainingCents : selected.fundType === 'sinking' ? selected.initialBalanceCents : selected.allocationCents)}</Text></Box>
            <Box p={4} bg={mutedBg} borderRadius="md"><Text fontSize="sm" color="gray.500">Parent contribution{selected.allocationMode === 'scheduled' ? ` / ${selected.periodType}` : ''}</Text><Text fontSize="2xl" fontWeight="bold">{money(selected.allocationMode === 'scheduled' ? selected.allocationCents : 0)}</Text></Box>
          </SimpleGrid>
          <Box>
            <Heading size="sm" mb={2}>Sub-funds</Heading>
            <Text fontSize="sm" color="gray.500" mb={3}>Sub-funds add to the parent reservation. Move existing money from the parent to avoid increasing the total. Each category belongs to one fund or sub-fund.</Text>
            {!children.length ? <Text color="gray.500">Add people for birthdays, or groups such as gifts, stockings, and holiday groceries.</Text> : <Box overflowX="auto"><Table size="sm"><Thead><Tr><Th>Name / occasion</Th><Th>Categories</Th><Th isNumeric>Remaining</Th><Th>Purchase status</Th><Th /></Tr></Thead><Tbody>{children.map(child => {
              const childState = child.archivedAt ? { remainingCents: child.archivedRemainingCents, transactions: [] } : states.get(child.id);
              const purchases = (childState?.transactions || []).filter(row => row.type !== 'adjustment' && row.amount < 0 && !row.excluded);
              return <Tr key={child.id} opacity={child.active ? 1 : 0.6}><Td><Button variant="link" onClick={() => setChildFilter(String(child.id))}>{child.name}</Button><Text fontSize="xs" color="gray.500">{child.occasionDate || 'No occasion date'}{!child.active && (child.archivedAt ? ' · Archived' : ' · Disabled')}</Text></Td>
                <Td>{child.categoryIds.map(id => categories.find(category => Number(category.id) === id)?.name || id).join(', ') || 'No category selected'}</Td><Td isNumeric>{money(childState?.remainingCents)}{child.allocationMode === 'scheduled' && <Text fontSize="xs" color="gray.500">+{money(child.allocationCents)} / {child.periodType}</Text>}</Td>
                <Td><Badge colorScheme={child.purchasedOn ? 'green' : purchases.length ? 'blue' : 'gray'}>{child.purchasedOn ? `Completed ${child.purchasedOn}` : purchases.length ? 'Spending recorded · verify gift' : 'Not purchased'}</Badge></Td><Td><Button size="xs" onClick={() => edit(child)}>Settings</Button></Td></Tr>;
            })}</Tbody></Table></Box>}
          </Box>
          <Box>
            <HStack justify="space-between" mb={3} flexWrap="wrap" gap={2}><Heading size="sm">Activity register</Heading><HStack><Select aria-label="Register period" size="sm" value={scope} onChange={event => setScope(event.target.value)}><option value="period">Current period</option><option value="all">All time</option></Select>{children.length > 0 && <Select aria-label="Register sub-fund" size="sm" value={childFilter} onChange={event => setChildFilter(event.target.value)}><option value="">Entire fund</option>{members.map(member => <option key={member.id} value={member.id}>{member.id === selectedId ? 'Unassigned' : member.name}</option>)}</Select>}</HStack></HStack>
            <Text fontSize="sm" color="gray.500" mb={3}>Funding, adjustments, spending, and refunds. Adjustments only change reserved money; they do not create bank transactions. Mark a gift complete in its sub-fund settings after checking the category.</Text>
            {registerLoading ? <Spinner /> : !rows.length ? <Text color="gray.500">No activity in this period.</Text> : <Box overflowX="auto" maxH="60vh"><Table size="sm"><Thead position="sticky" top={0} bg={bg} zIndex={1}><Tr><Th>Date</Th><Th>Fund</Th><Th>Activity</Th><Th>Type</Th><Th isNumeric>Amount</Th><Th /></Tr></Thead><Tbody>{rows.map(row => <Tr key={`${row.fundId}:${row.transactionId}`} opacity={row.excluded ? 0.5 : 1}><Td whiteSpace="nowrap">{row.date}</Td><Td>{row.subFundName}</Td><Td>{row.description}</Td><Td><Badge>{row.excluded ? 'Excluded' : row.type}</Badge></Td><Td isNumeric whiteSpace="nowrap" color={row.amount > 0 ? 'green.500' : undefined}>{row.amount > 0 ? '+' : ''}{formatCurrency(row.amount)}</Td><Td>{!selected.archivedAt && !funds.find(fund => fund.id === row.fundId)?.archivedAt && ['actual', 'pending'].includes(row.type) && <Button size="xs" onClick={() => toggleExclusion(row)}>{row.excluded ? 'Re-include' : 'Exclude'}</Button>}</Td></Tr>)}</Tbody></Table></Box>}
          </Box>
        </VStack>}
      </>}
      <Drawer isOpen={form.isOpen} onClose={form.onClose} size="lg"><DrawerOverlay /><DrawerContent><DrawerCloseButton /><DrawerHeader>{editingFund?.id ? 'Fund settings' : editingFund?.parentId ? 'Add sub-fund' : 'Create fund'}</DrawerHeader><DrawerBody>{error && <Alert status="error" mb={4}><AlertIcon />{error}</Alert>}{!editingFund?.archivedAt && <OperationalFundForm accountKey={accountKey} categories={categories} funds={funds} fund={editingFund} onSave={save} onCancel={form.onClose} saving={saving} />}{editingFund?.id && <Button mt={6} mr={3} colorScheme="blue" isLoading={saving} onClick={() => setArchive(editingFund)}>{editingFund.archivedAt ? 'Restore fund' : 'Archive fund'}</Button>}{editingFund?.id && <Button mt={6} colorScheme="red" variant="outline" onClick={() => remove(editingFund)}>Delete fund</Button>}</DrawerBody></DrawerContent></Drawer>
      <Drawer isOpen={adjust.isOpen} onClose={adjust.onClose} size="md"><DrawerOverlay /><DrawerContent><DrawerCloseButton /><DrawerHeader>Adjust reserved money</DrawerHeader><DrawerBody>{error && <Alert status="error" mb={4}><AlertIcon />{error}</Alert>}<Box as="form" onSubmit={saveAdjustment}><VStack spacing={4} align="stretch"><Text>Record a deposit or withdrawal from the fund without changing the opening balance. Use a negative amount to remove money.</Text><FormControl isRequired><FormLabel>Fund</FormLabel><Select value={adjustment.fundId} onChange={event => setAdjustment({ ...adjustment, fundId: event.target.value, transferToId: '' })}>{members.filter(member => member.fundType !== 'operating').map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</Select></FormControl><FormControl isRequired><FormLabel>Amount (+ add / − remove)</FormLabel><Input type="number" step="0.01" required value={adjustment.amount} onChange={event => setAdjustment({ ...adjustment, amount: event.target.value })} /></FormControl><FormControl><FormLabel>Move removed money to (optional)</FormLabel><Select value={adjustment.transferToId} onChange={event => setAdjustment({ ...adjustment, transferToId: event.target.value })}><option value="">Adjustment only — no destination</option>{funds.filter(member => member.id !== Number(adjustment.fundId) && member.fundType !== 'operating' && !member.archivedAt && member.active && (!member.parentId || funds.find(parent => parent.id === member.parentId)?.active)).map(member => <option value={member.id} key={member.id}>{member.parentId ? `${funds.find(parent => parent.id === member.parentId)?.name} / ` : ''}{member.name}</option>)}</Select><Text fontSize="sm" color="gray.500" mt={2}>{adjustment.transferToId ? 'Enter a negative amount. The same amount will be added to the destination fund.' : 'Adjustment only changes this fund. Removing money releases it to available-to-spend; adding money reserves it. No bank transaction is created.'}</Text></FormControl><FormControl isRequired><FormLabel>Reason</FormLabel><Input required value={adjustment.note} onChange={event => setAdjustment({ ...adjustment, note: event.target.value })} /></FormControl><Button type="submit" colorScheme="blue" isLoading={saving}>Record entry</Button></VStack></Box></DrawerBody></DrawerContent></Drawer>
    </Box>
  );
};
export default OperationalFundsManager;
