import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Drawer, DrawerBody, DrawerCloseButton, DrawerContent,
  DrawerFooter, DrawerHeader, DrawerOverlay, FormControl, FormLabel, Heading, HStack, Image, Input,
  Link, Select, SimpleGrid, Spinner, Table, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue,
} from '@chakra-ui/react';
import {
  createReconciliationSession, getApiErrorMessage, getReconciliationSession, reviewReconciliationEvidence,
  runReconciliation, uploadReconciliationEvidence,
} from '../backendApi';
import { formatCurrency } from '../utils';

const money = cents => formatCurrency((cents || 0) / 100);
const kindName = { capital_one: 'Capital One posted CSV', venmo: 'Venmo supporting CSV', pending: 'Pending screenshot' };
const dispositionLabel = value => String(value || '').replaceAll('_', ' ');
const fileUrl = (sessionId, id) => `/api/reconciliation/sessions/${sessionId}/evidence/${id}/content`;

const EvidenceReview = ({ file, sessionId, onClose, onSave, busy }) => {
  const [review, setReview] = useState(() => structuredClone(file.review || { ...file.extraction, useDocument: true, confirmed: false }));
  const updateRow = (key, values) => setReview(current => ({ ...current, confirmed: false, rows: current.rows.map(row => row.key === key ? { ...row, ...values } : row) }));
  const relevant = review.rows.filter(row => row.relevant);
  return <Drawer isOpen onClose={onClose} size="full"><DrawerOverlay /><DrawerContent><DrawerCloseButton /><DrawerHeader>
    Review evidence · {file.filename}<Text fontSize="sm" color="gray.500">{kindName[file.kind]} · originals are retained unchanged</Text>
  </DrawerHeader><DrawerBody>
    <VStack align="stretch" spacing={4}>
      <Checkbox isChecked={review.useDocument !== false} onChange={event => setReview({ ...review, useDocument: event.target.checked, confirmed: false })}>Use this document in the reconciliation</Checkbox>
      {review.useDocument === false ? <FormControl isRequired><FormLabel>Reason for excluding this document</FormLabel><Input value={review.documentExclusionReason || ''} onChange={event => setReview({ ...review, documentExclusionReason: event.target.value })} /></FormControl> : <>
        <Alert status="info"><AlertIcon />Confirm this file belongs to the selected bank account. Correct extracted rows and explicitly explain exclusions. Positive amounts are inflows; negative amounts are outflows.</Alert>
        {(file.extraction.warnings || []).map((warning, index) => <Text key={index} fontSize="sm" color="orange.600">{warning}</Text>)}
        {file.kind === 'pending' && <Image src={fileUrl(sessionId, file.id)} alt={`Original evidence: ${file.filename}`} maxH="550px" objectFit="contain" alignSelf="start" />}
        <Link href={fileUrl(sessionId, file.id)} target="_blank" rel="noreferrer">Open original {file.kind === 'pending' ? 'image' : 'CSV'}</Link>
        {file.kind === 'capital_one' && <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
          <FormControl isRequired><FormLabel>Export coverage starts</FormLabel><Input type="date" value={review.coverageStart || ''} onChange={event => setReview({ ...review, coverageStart: event.target.value, confirmed: false })} /></FormControl>
          <FormControl isRequired><FormLabel>Export coverage ends</FormLabel><Input type="date" value={review.coverageEnd || ''} onChange={event => setReview({ ...review, coverageEnd: event.target.value, confirmed: false })} /></FormControl>
        </SimpleGrid>}
        <Text fontSize="sm">{relevant.length} included rows · outflows {money(-relevant.filter(row => row.amountCents < 0).reduce((sum, row) => sum + row.amountCents, 0))} · inflows {money(relevant.filter(row => row.amountCents > 0).reduce((sum, row) => sum + row.amountCents, 0))}</Text>
        <Box overflow="auto" maxH="500px"><Table size="sm"><Thead><Tr><Th>Include / source</Th><Th>Date</Th><Th>Description</Th><Th>Signed amount</Th><Th>Context / exclusion reason</Th></Tr></Thead><Tbody>
          {review.rows.map(row => <Tr key={row.key} opacity={row.relevant ? 1 : 0.65}>
            <Td><Checkbox aria-label={`Include evidence row ${row.sourceRow}`} isChecked={Boolean(row.relevant)} onChange={event => updateRow(row.key, { relevant: event.target.checked })}>Line {row.sourceRow}</Checkbox></Td>
            <Td minW="170px"><Input aria-label={`Date for row ${row.sourceRow}`} size="sm" type="date" value={row.date || ''} onChange={event => updateRow(row.key, { date: event.target.value })} /></Td>
            <Td minW="240px"><Input aria-label={`Description for row ${row.sourceRow}`} size="sm" value={row.description || ''} onChange={event => updateRow(row.key, { description: event.target.value })} />{row.issue && <Text fontSize="xs" color="orange.600">{row.issue}</Text>}</Td>
            <Td minW="145px"><Input aria-label={`Signed amount for row ${row.sourceRow}`} size="sm" type="number" step="0.01" value={row.amountCents == null ? '' : row.amountCents / 100} onChange={event => updateRow(row.key, { amountCents: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100) })} /></Td>
            <Td minW="220px">{file.kind === 'venmo' && <Text fontSize="xs">{row.status} · From: {row.fundingSource || 'not specified'} · To: {row.destination || 'not specified'}</Text>}{!row.relevant && <Input aria-label={`Exclusion reason for row ${row.sourceRow}`} size="sm" placeholder="Why this row is excluded" value={row.exclusionReason || ''} onChange={event => updateRow(row.key, { exclusionReason: event.target.value })} />}</Td>
          </Tr>)}
        </Tbody></Table></Box>
        {file.kind === 'pending' && <Button alignSelf="start" variant="outline" onClick={() => setReview({ ...review, confirmed: false, rows: [...review.rows, { key: `manual:${Date.now()}`, sourceRow: `manual ${review.rows.length + 1}`, date: '', description: '', amountCents: null, currency: 'USD', relevant: true }] })}>Add a pending charge from the image</Button>}
        {file.kind === 'pending' && !relevant.length && <Checkbox isChecked={Boolean(review.noRelevantRows)} onChange={event => setReview({ ...review, noRelevantRows: event.target.checked })}>I verified that this image contains no relevant pending charges</Checkbox>}
        {file.kind === 'venmo' && <Checkbox isChecked={Boolean(review.fundingVerified)} onChange={event => setReview({ ...review, fundingVerified: event.target.checked, confirmed: false })}>I verified that every included Venmo row was funded by or transferred to this selected bank account. Venmo-balance or other-account activity is excluded above.</Checkbox>}
        <Box as="details"><Box as="summary" cursor="pointer">Extracted source text</Box><Text as="pre" fontSize="xs" whiteSpace="pre-wrap" maxH="250px" overflow="auto">{file.extractedText || 'No text extracted; use the original image.'}</Text></Box>
      </>}
      <Checkbox isChecked={Boolean(review.confirmed)} onChange={event => setReview({ ...review, confirmed: event.target.checked })}>I compared these rows and exclusions with the original evidence and checked the account, dates, directions, and amounts</Checkbox>
    </VStack>
  </DrawerBody><DrawerFooter gap={3}><Button onClick={onClose}>Cancel</Button><Button colorScheme="blue" isLoading={busy} isDisabled={!review.confirmed} onClick={() => onSave({ ...review, rows: review.rows.map(row => ({ ...row, fundingVerified: file.kind === 'venmo' ? Boolean(review.fundingVerified) : undefined })) })}>Save evidence review</Button></DrawerFooter></DrawerContent></Drawer>;
};

const AccountingTable = ({ result }) => {
  const rows = [
    ['Bank export totals', result.stats.bank], ['Bank → LM matched', result.stats.bankMatched],
    ['Bank missing in LM', result.stats.bankMissing], ['Bank matches ambiguous', result.stats.bankAmbiguous],
    ['LM accounting records', result.stats.lm], ['LM → bank matched', result.stats.lmMatched],
    ['LM extras in coverage', result.stats.lmExtra], ['Unmatched pending / placeholders', result.stats.lmPending],
    ['Unmatched boundary / outside coverage', result.stats.lmBoundary], ['LM matches ambiguous', result.stats.lmAmbiguous],
    ['LM recurring projections (not bank rows)', result.stats.lmProjected],
  ];
  return <Box overflowX="auto"><Table size="sm"><Thead><Tr><Th>Disposition</Th><Th isNumeric>Debits</Th><Th isNumeric>Debit total</Th><Th isNumeric>Credits</Th><Th isNumeric>Credit total</Th></Tr></Thead><Tbody>{rows.map(([name, stat]) => <Tr key={name}><Td>{name}</Td><Td isNumeric>{stat.debitCount}</Td><Td isNumeric>{money(stat.debitCents)}</Td><Td isNumeric>{stat.creditCount}</Td><Td isNumeric>{money(stat.creditCents)}</Td></Tr>)}</Tbody></Table></Box>;
};

const ReconciliationResults = ({ run, onDecisions, busy }) => {
  const { result } = run;
  const [manual, setManual] = useState({ bankKey: '', transactionId: '', reason: '' });
  const [category, setCategory] = useState('all');
  const bankByKey = new Map(result.bankRows.map(row => [row.key, row]));
  const lmById = new Map(result.lmRows.map(row => [row.transactionId, row]));
  const exceptions = result.findings.filter(finding => category === 'all' || finding.category === category);
  const matchingBank = bankByKey.get(manual.bankKey);
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `reconciliation-${run.id}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <VStack align="stretch" spacing={4}>
    {run.stale && <Alert status="warning"><AlertIcon />Evidence changed after this result. Run reconciliation again before relying on it.</Alert>}
    <Alert status={result.reconciliation === 'reconciled' && !run.stale ? 'success' : 'warning'}><AlertIcon /><Box>
      <Text fontWeight="bold">{result.reconciliation === 'reconciled' ? 'Posted transaction register reconciled in both directions' : 'Reconciliation needs review'}</Text>
      <Text fontSize="sm">Completeness: {result.completeness} · bank → LM: {dispositionLabel(result.bankToLm)} · LM → bank: {dispositionLabel(result.lmToBank)}</Text>
      <Text fontSize="sm">{result.findings.length} concerns to review, including pending activity. Pending concerns do not by themselves mean a bank-posted transaction is missing.</Text>
    </Box></Alert>
    <HStack justify="space-between" flexWrap="wrap"><Text fontSize="sm">Saved {new Date(run.completedAt).toLocaleString()} · LM queried {result.queriedRange.startDate} – {result.queriedRange.endDate}, including 5-day padding</Text><Button size="sm" variant="outline" onClick={exportReport}>Download report</Button></HStack>
    <AccountingTable result={result} />
    <Text fontSize="sm">Counts and cent totals checked: {result.countsAndAmountsVerified ? 'Passed' : 'Not verified'} · {result.sourceSnapshot.uniqueRawRecordCount} unique LM records fetched across all pages; {result.sourceSnapshot.accountingRecordCount} accounting records after split/group handling.</Text>
    <Text fontSize="sm" color="gray.500">{result.balanceNote}</Text>
    {result.limitations.map((text, index) => <Alert key={index} status="warning"><AlertIcon />{text}</Alert>)}
    <HStack justify="space-between" flexWrap="wrap"><Heading size="sm">Potential concerns</Heading><Select aria-label="Reconciliation concern type" w="auto" maxW="100%" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All concerns</option>{[...new Set(result.findings.map(row => row.category))].map(name => <option key={name} value={name}>{dispositionLabel(name)}</option>)}</Select></HStack>
    {!exceptions.length && <Text color="gray.500">No concerns in this selection.</Text>}
    <Box maxH="550px" overflowY="auto"><VStack align="stretch" spacing={3}>{exceptions.map(finding => <Box key={finding.id} p={3} borderWidth="1px" borderRadius="md">
      <Badge>{dispositionLabel(finding.category)}</Badge><Text fontWeight="semibold" mt={1}>{finding.title}</Text>
      {finding.bankKeys.map(key => { const row = bankByKey.get(key); return <Text key={key} fontSize="sm">Bank: {row.date} · {row.description} · {money(row.amountCents)} · {row.evidence.map(ref => `${ref.filename}, line ${ref.sourceRow}`).join('; ')}</Text>; })}
      {finding.transactionIds.map(id => { const row = lmById.get(id); return <Text key={id} fontSize="sm">LM #{id}: {row.date} · {row.payee} · {money(row.amountCents)} · {row.source} · {row.effectiveStatus}{row.tagNames?.length ? ` · ${row.tagNames.join(', ')}` : ''}</Text>; })}
      {finding.supportingEvidence.map((ref, index) => <Text key={index} fontSize="sm">Evidence: {ref.filename}, line {ref.sourceRow}{ref.amountCents != null ? ` · ${money(ref.amountCents)}` : ''}</Text>)}
    </Box>)}</VStack></Box>
    <Box as="details"><Box as="summary" cursor="pointer" fontWeight="semibold">Confirm an ambiguous or differently named match</Box>
      <Text fontSize="sm" color="gray.500" my={2}>This only records your evidence decision in the reconciliation; it does not edit LM. Amounts must agree and each record can be matched once.</Text>
      <VStack align="stretch" spacing={2}><Select aria-label="Bank row to match" value={manual.bankKey} onChange={event => setManual({ ...manual, bankKey: event.target.value, transactionId: '' })}><option value="">Select a bank row</option>{result.bankRows.filter(row => row.disposition !== 'matched').map(row => <option key={row.key} value={row.key}>{row.date} · {row.description} · {money(row.amountCents)}</option>)}</Select>
        <Select aria-label="LM record to match" value={manual.transactionId} onChange={event => setManual({ ...manual, transactionId: event.target.value })}><option value="">Select an LM record with the same amount</option>{result.lmRows.filter(row => !['matched', 'projected_not_bank'].includes(row.disposition) && row.amountCents === matchingBank?.amountCents).map(row => <option key={row.transactionId} value={row.transactionId}>#{row.transactionId} · {row.date} · {row.payee} · {row.source}</option>)}</Select>
        <Input aria-label="Reason for evidence match" placeholder="Evidence supporting this match" value={manual.reason} onChange={event => setManual({ ...manual, reason: event.target.value })} />
        <Button alignSelf="start" isDisabled={busy || !manual.bankKey || !manual.transactionId || !manual.reason.trim() || run.stale} onClick={() => onDecisions(manual)}>Confirm match and rerun</Button>
      </VStack>
    </Box>
    <Box as="details"><Box as="summary" cursor="pointer" fontWeight="semibold">Complete bank and LM disposition registers</Box><Box overflow="auto" maxH="450px"><Table size="sm"><Thead><Tr><Th>Source / evidence</Th><Th>Date</Th><Th>Payee</Th><Th isNumeric>Amount</Th><Th>Disposition</Th></Tr></Thead><Tbody>
      {result.bankRows.map(row => <Tr key={row.key}><Td>{row.evidence.map(ref => `${ref.filename}:${ref.sourceRow}`).join(', ')}</Td><Td>{row.date}</Td><Td>{row.description}</Td><Td isNumeric>{money(row.amountCents)}</Td><Td>{dispositionLabel(row.disposition)}{row.transactionId ? ` · LM #${row.transactionId}` : ''}</Td></Tr>)}
      {result.lmRows.map(row => <Tr key={`lm:${row.transactionId}`}><Td>LM #{row.transactionId} · {row.source}</Td><Td>{row.date}</Td><Td>{row.payee}</Td><Td isNumeric>{money(row.amountCents)}</Td><Td>{dispositionLabel(row.disposition)}</Td></Tr>)}
    </Tbody></Table></Box></Box>
    <Box as="details"><Box as="summary" cursor="pointer" fontWeight="semibold">Evidence coverage, overlap handling, and exclusions</Box>
      {result.coverage.map(row => <Text key={row.evidenceId} fontSize="sm">{row.filename}: {row.startDate} – {row.endDate}</Text>)}
      <Text fontSize="sm">{result.overlapHandling.excludedDuplicateRows} repeated rows across bank exports consolidated. {result.overlapHandling.policy}</Text>
      {result.evidenceManifest.map(file => <Box key={file.id} mt={2}><Text fontSize="sm">{file.filename} · {file.included ? 'Included' : `Excluded: ${file.exclusionReason}`} · reviewed {new Date(file.reviewedAt).toLocaleString()}</Text><Text fontSize="xs" overflowWrap="anywhere">SHA-256: {file.sha256}</Text>{file.excludedRows.map((row, index) => <Text key={index} fontSize="xs">Line {row.sourceRow}: {row.description} · excluded: {row.reason}</Text>)}</Box>)}
      <Text fontSize="sm">{result.sourceSnapshot.splitAndGroupPolicy}</Text>
      {result.sourceSnapshot.structuralRecords.map(row => <Text key={row.transactionId} fontSize="xs">LM #{row.transactionId}: {dispositionLabel(row.disposition)} · {row.reason}</Text>)}
    </Box>
    <Box as="details"><Box as="summary" cursor="pointer" fontWeight="semibold">Verified clearance register</Box>{!result.clearanceRegister.length ? <Text fontSize="sm">The register is empty.</Text> : result.clearanceRegister.map(row => <Text key={row.transactionId} fontSize="sm">LM #{row.transactionId} · {row.date} · {row.payee} · {money(row.amountCents)} · {row.status} · {row.reason} · verified {row.verifiedAt}</Text>)}</Box>
  </VStack>;
};

const ReconciliationWorkflow = ({ accountKey }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [kind, setKind] = useState('capital_one');
  const [reviewing, setReviewing] = useState(null);
  const fileInput = useRef(null);
  const bg = useColorModeValue('white', 'gray.700');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSession(await getReconciliationSession(accountKey)); }
    catch (err) { setError(getApiErrorMessage(err)); }
    finally { setLoading(false); }
  }, [accountKey]);
  useEffect(() => { load(); }, [load]);
  const start = async () => { setBusy('Starting session'); setError(''); try { setSession(await createReconciliationSession(accountKey)); } catch (err) { setError(getApiErrorMessage(err)); } finally { setBusy(''); } };
  const upload = async event => {
    const files = [...event.target.files]; event.target.value = ''; if (!files.length) return;
    setError('');
    try {
      const current = session || await createReconciliationSession(accountKey); setSession(current);
      for (const file of files) {
        setBusy(`Reading ${file.name}${kind === 'pending' ? ' · screenshot extraction may take up to 30 seconds' : ''}`);
        await uploadReconciliationEvidence(current.id, kind, file);
      }
    } catch (err) { setError(getApiErrorMessage(err)); }
    finally { try { setSession(await getReconciliationSession(accountKey)); } catch { /* Preserve the original upload error. */ } setBusy(''); }
  };
  const saveReview = async review => {
    setBusy('Saving evidence review'); setError('');
    try { setSession(await reviewReconciliationEvidence(session.id, reviewing.id, review)); setReviewing(null); }
    catch (err) { setError(getApiErrorMessage(err)); }
    finally { setBusy(''); }
  };
  const run = async decisions => {
    setBusy('Reconciling all evidence against fresh Lunch Money data'); setError('');
    try { setSession(await runReconciliation(session.id, decisions || session.decisions)); }
    catch (err) { setError(getApiErrorMessage(err)); }
    finally { setBusy(''); }
  };
  return <Box bg={bg} borderWidth="1px" borderRadius="md" p={{ base: 4, lg: 5 }}>
    <HStack justify="space-between" flexWrap="wrap" gap={3}><Box><Heading size="md">Reconciliation</Heading><Text fontSize="sm" color="gray.500">Upload evidence, review it, then reconcile the selected account in both directions.</Text></Box><Button variant="outline" size="sm" isDisabled={Boolean(busy)} onClick={start}>New reconciliation</Button></HStack>
    {error && <Alert status="error" mt={3}><AlertIcon />{error}</Alert>}
    {busy && <HStack mt={3}><Spinner size="sm" /><Text fontSize="sm">{busy}</Text></HStack>}
    {loading ? <Spinner mt={4} /> : <VStack align="stretch" spacing={4} mt={4}>
      <Box><Heading size="sm">1. Add supporting evidence</Heading><Text fontSize="sm" color="gray.500" mt={1}>Capital One and Venmo CSV exports; pending-charge screenshots in PNG or JPEG. Files stay in this installation. Evidence and runs are saved with this account.</Text>
        <HStack mt={3} flexWrap="wrap"><Select aria-label="Evidence type" value={kind} onChange={event => setKind(event.target.value)} w="auto" maxW="100%">{Object.entries(kindName).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select><Button isDisabled={Boolean(busy)} onClick={() => fileInput.current.click()}>Upload files</Button><input ref={fileInput} type="file" aria-label="Supporting evidence files" accept={kind === 'pending' ? 'image/png,image/jpeg' : '.csv,text/csv'} multiple hidden onChange={upload} /></HStack>
      </Box>
      {session?.evidence.length > 0 && <Box><Heading size="sm">2. Review the evidence</Heading><Box overflowX="auto"><Table size="sm"><Thead><Tr><Th>Document</Th><Th>Source</Th><Th>Review</Th><Th /></Tr></Thead><Tbody>{session.evidence.map(file => <Tr key={file.id}><Td>{file.filename}</Td><Td>{kindName[file.kind]}</Td><Td><Badge colorScheme={file.reviewedAt ? 'green' : 'orange'}>{file.reviewedAt ? file.review.useDocument === false ? 'Excluded' : 'Reviewed' : 'Needs review'}</Badge></Td><Td><Button size="sm" isDisabled={Boolean(busy)} onClick={() => setReviewing(file)}>Review evidence</Button></Td></Tr>)}</Tbody></Table></Box></Box>}
      <HStack justify="space-between" flexWrap="wrap" gap={3}><Box><Heading size="sm">3. Run reconciliation</Heading><Text fontSize="sm" color="gray.500">Every included bank row and LM record is classified. No LM transactions are changed.</Text></Box><Button colorScheme="blue" isLoading={Boolean(busy)} isDisabled={!session?.evidence.length || session.evidence.some(file => !file.reviewedAt)} onClick={() => run()}>Reconcile now</Button></HStack>
      {session?.latestRun && <ReconciliationResults key={session.latestRun.id} run={session.latestRun} busy={Boolean(busy)} onDecisions={decision => run([...(session.decisions || []), decision])} />}
    </VStack>}
    {reviewing && <><EvidenceReview key={reviewing.id} file={reviewing} sessionId={session.id} onClose={() => setReviewing(null)} onSave={saveReview} busy={Boolean(busy)} />{error && <Alert status="error" position="fixed" bottom={20} left="5%" w="90%" zIndex={1500}><AlertIcon />{error}</Alert>}</>}
  </Box>;
};
export default ReconciliationWorkflow;
