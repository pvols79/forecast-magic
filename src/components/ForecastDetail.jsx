import {
  Badge, Box, Heading, HStack, Table, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue,
} from '@chakra-ui/react';
import { formatCurrency } from '../utils';

const money = cents => formatCurrency((cents || 0) / 100);
const signed = amount => `${amount > 0 ? '+' : ''}${formatCurrency(Number(amount || 0))}`;
const decision = event => ({
  opening: event.type === 'recurring-projected' ? 'Missing recurring occurrence → opening adjustment'
    : event.lunchMoneySource === 'recurring' ? 'LM recurring transaction → opening adjustment'
      : `Unreflected in bank balance → opening adjustment${event.tagNames?.length ? ` (${event.tagNames.join(', ')})` : event.isPending || event.is_pending ? ' (LM pending flag)' : ''}`,
  projected: `Applied on ${event.date}`,
  'included-in-bank': 'Already reflected in synced balance; no extra adjustment',
  'outside-horizon': 'Outside the calculated horizon',
  'recurring-satisfied': 'Skipped: an LM transaction satisfies this recurring occurrence',
})[event.modelTreatment] || event.modelTreatment;

const ReportTable = ({ headers, rows }) => {
  const bg = useColorModeValue('white', 'gray.700');
  return !rows.length ? <Text color="gray.500" mt={3}>None in the queried range.</Text> :
    <Box overflow="auto" maxH="440px" mt={3}><Table size="sm"><Thead position="sticky" top={0} bg={bg} zIndex={1}><Tr>{headers.map((header, index) => <Th key={header} isNumeric={index >= headers.length - 2}>{header}</Th>)}</Tr></Thead><Tbody>
      {rows.map((row, index) => <Tr key={index}>{row.map((cell, column) => <Td key={column} isNumeric={column >= headers.length - 2} whiteSpace={column >= headers.length - 2 ? 'nowrap' : undefined}>{cell}</Td>)}</Tr>)}
    </Tbody></Table></Box>;
};

const Section = ({ title, children, open = false }) => <Box as="details" open={open || undefined} borderTopWidth="1px" py={4}>
  <Box as="summary" cursor="pointer" fontWeight="semibold">{title}</Box>{children}
</Box>;

const ForecastDetail = ({ projection, account }) => {
  const bg = useColorModeValue('white', 'gray.700');
  const totalBg = useColorModeValue('blue.50', 'blue.900');
  if (!projection?.openingBalance) return null;
  const opening = projection.openingBalance;
  const events = projection.eventDecisions || [];
  const lmEvents = events.filter(event => event.type !== 'recurring-projected');
  const recurringEvents = events.filter(event => event.type === 'recurring-projected');
  const fundRoots = projection.operationalFunds || [];
  const funds = fundRoots.flatMap(root => [{ ...root, displayName: root.name }, ...(root.children || []).map(child => ({ ...child, displayName: `${root.name} → ${child.name}` }))]);
  const allocations = projection.dailyBalances.flatMap(day => (day.operationalFundAnnotations || []).map(row => ({ ...row, date: day.date })));
  const drawdowns = projection.dailyBalances.flatMap(day => (day.operationalFundDrawdowns || []).map(row => ({ ...row, date: day.date })));
  const eventRows = list => list.map(event => [
    <Box key="event"><Text>{event.date} · {event.description}</Text><Text fontSize="xs" color="gray.500">{event.transactionId ? `LM #${event.transactionId}` : `Recurring #${event.recurringId}`} · {event.lunchMoneySource || event.type}{event.auditClearance ? ' · verified retained replacement' : ''}</Text></Box>,
    decision(event), signed(event.amount), signed(event.todayImpact),
  ]);
  const steps = [
    ['Lunch Money synced bank balance', opening.syncedAccountBalance],
    ['Opening adjustments (including missing recurring activity)', opening.adjustmentTotal],
    ['Adjusted opening ledger', opening.ledgerBalance],
    ["Today's forecast activity", opening.anchorDateEventTotal],
    ["Today's projected ledger", opening.projectedLedgerBalance],
    ['Fund reservations (parent and sub-funds, deducted once)', -opening.reservedOperationalFunds],
  ];
  return <VStack align="stretch" spacing={4}>
    <Box><Heading size="lg">Forecast Detail</Heading><Text mt={1} color="gray.500">{account?.name} · {opening.date} · from the synced balance to available to spend today</Text></Box>
    <Box bg={bg} borderWidth="1px" borderRadius="md" p={{ base: 4, lg: 5 }}>
      <Heading size="md" mb={3}>Today&apos;s calculation</Heading>
      {steps.map(([label, value]) => <HStack key={label} justify="space-between" py={2} gap={4}><Text>{label}</Text><Text fontWeight="semibold" whiteSpace="nowrap" fontVariantNumeric="tabular-nums">{formatCurrency(value)}</Text></HStack>)}
      <HStack justify="space-between" bg={totalBg} p={4} borderRadius="md" mt={3}><Heading size="sm">Available to Spend Today</Heading><Text fontSize="2xl" fontWeight="bold">{formatCurrency(opening.availableToSpend)}</Text></HStack>
      <Text fontSize="xs" color="gray.500" mt={3}>Bank balance updated: {account?.lastUpdated || 'not supplied by Lunch Money'}. Calculated: {new Date(projection.generatedAt).toLocaleString()}.</Text>
      <Text fontSize="xs" color="gray.500">LM activity queried {projection.queryStartDate} through {projection.queryEndDate}. Future activity affects its scheduled date, not today. The model checks at least 90 days even when the chart shows less.</Text>
    </Box>
    <Box bg={bg} borderWidth="1px" borderRadius="md" p={{ base: 4, lg: 5 }}>
      <Heading size="md" mb={3}>Show the work</Heading>
      <Section title={`Opening adjustments · ${signed(opening.adjustmentTotal)} today`} open>
        <ReportTable headers={['Activity / source', 'Model treatment', 'Amount', 'Today’s impact']} rows={eventRows(events.filter(event => event.modelTreatment === 'opening'))} />
      </Section>
      <Section title={`Today's forecast activity · ${signed(opening.anchorDateEventTotal)}`}>
        <ReportTable headers={['Activity / source', 'Model treatment', 'Amount', 'Today’s impact']} rows={eventRows(events.filter(event => event.modelTreatment === 'projected' && event.date === opening.date))} />
      </Section>
      <Section title={`Lunch Money transactions · ${lmEvents.length} records, including future-dated`}>
        <Text fontSize="sm" color="gray.500" mt={2}>Posted history is already in the synced bank balance. Explicit unreflected activity is adjusted once. Unresolved duplicate placeholders remain separate records until resolved.</Text>
        <ReportTable headers={['Activity / source', 'Model treatment', 'Amount', 'Today’s impact']} rows={eventRows(lmEvents)} />
      </Section>
      <Section title={`Recurring forecasts · ${recurringEvents.length} supplied missing occurrences`}>
        <ReportTable headers={['Occurrence', 'Model treatment', 'Amount', 'Today’s impact']} rows={eventRows(recurringEvents)} />
        <Heading size="sm" mt={4}>Recurring schedule decisions</Heading>
        <ReportTable headers={['Occurrence', 'Model treatment', 'Scheduled amount', 'Today’s impact']} rows={(projection.recurringOccurrences || []).map(row => {
          const event = recurringEvents.find(event => event.recurringId === row.recurringId && event.date === row.date);
          const treatment = event ? decision(event) : row.status === 'matched' ? `Matched by Lunch Money${row.transactionId ? ` to LM #${row.transactionId}` : ''}; no extra prediction`
            : row.status === 'missing' ? 'No prediction: nearby found transaction satisfies this occurrence (within 3 days)' : 'LM expected occurrence; not supplied as missing';
          return [`${row.date} · ${row.description}`, treatment, signed(row.amount), signed(event?.todayImpact)];
        })} />
      </Section>
      <Section title={`Fund reservations · ${formatCurrency(opening.reservedOperationalFunds)} held today`} open>
        <Text fontSize="sm" color="gray.500" mt={2}>A parent&apos;s combined hold includes its sub-funds. Only the combined hold is deducted. Each sub-fund still requires its own funding.</Text>
        <ReportTable headers={['Fund / sub-fund', 'Type / current period', 'Own remaining', 'Combined hold']} rows={funds.map(fund => [
          fund.displayName, `${fund.fundType} · ${fund.periodStart}${fund.periodEnd ? ` – ${fund.periodEnd}` : ' onward'}`,
          money(fund.ownRemainingCents ?? fund.remainingCents), fund.parentId ? 'Included above' : money(fund.remainingCents),
        ])} />
        <Heading size="sm" mt={4}>Funding and rollover behind each balance</Heading>
        <ReportTable headers={['Fund / sub-fund', 'Funding mode', 'Period funding', 'Carry-in']} rows={funds.map(fund => [
          fund.displayName, fund.allocationMode === 'scheduled' ? 'Scheduled' : 'Manual / opening funding', money(fund.allocationCents), money(fund.carryInCents),
        ])} />
        <Heading size="sm" mt={4}>Spending, refunds, and adjustments used by the funds</Heading>
        <ReportTable headers={['Fund activity', 'Treatment', 'Amount', 'Covered / restored']} rows={fundRoots.flatMap(root => (root.transactions || []).map(row => [
          `${row.date} · ${root.name}${row.subFundName ? ` → ${row.subFundName}` : ''} · ${row.description}`,
          row.excluded ? 'Excluded from fund only' : row.type === 'adjustment' ? 'Reservation adjustment; no bank transaction' : row.overBudgetCents ? `${money(row.overBudgetCents)} exceeds this fund’s funding` : 'Included in remaining reservation',
          signed(row.amount), row.excluded ? '—' : row.type === 'adjustment' ? 'Adjustment' : money((row.coveredCents || 0) + (row.restoredCents || 0)),
        ]))} />
      </Section>
      <Section title={`Future fund period changes · ${allocations.length} occurrences`}>
        <Text fontSize="sm" color="gray.500" mt={2}>These are model projections, not posted bank transactions. New contributions reserve cash on their occurrence date; carry-in is already held. Zero contributions may reflect a reached goal, a manual schedule, or a removed occurrence.</Text>
        <ReportTable headers={['Date / fund', 'Source', 'New allocation', 'Carry-in']} rows={allocations.map(row => [
          `${row.date} · ${row.name}`, row.sourceFundName || row.name, money(row.allocationCents), money(row.carryInCents),
        ])} />
      </Section>
      <Section title={`Future spending against funds · ${drawdowns.length} changes`}>
        <ReportTable headers={['Date / fund', 'Source', 'Covered spending', 'Restored refunds']} rows={drawdowns.map(row => [
          `${row.date} · ${row.name}`, row.sourceFundName || row.name, money(row.coveredCents), money(row.restoredCents),
        ])} />
      </Section>
      <Badge mt={3}>Read-only calculation report</Badge>
    </Box>
  </VStack>;
};
export default ForecastDetail;
