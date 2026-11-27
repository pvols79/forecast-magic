import { useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, HStack, IconButton, Progress, Text, useColorModeValue, usePrefersReducedMotion } from '@chakra-ui/react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { formatCurrency } from '../../utils';
import { allocationStatus } from '../../forecastDetail';

const money = value => value == null ? '—' : formatCurrency(value / 100);

const FundCarousel = ({ funds, states, selectedId, onSelect, allFunds }) => {
  const track = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const [edges, setEdges] = useState({ start: true, end: false });
  const bg = useColorModeValue('white', 'gray.700');
  const selectedBg = useColorModeValue('blue.50', 'blue.900');
  const textColor = useColorModeValue('gray.800', 'gray.100');
  useEffect(() => {
    const element = track.current;
    const update = () => setEdges({ start: element.scrollLeft <= 8, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 8 });
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { element.removeEventListener('scroll', update); observer.disconnect(); };
  }, [funds]);
  const scroll = direction => track.current.scrollBy({ left: direction * track.current.clientWidth * 0.75, behavior: reducedMotion ? 'auto' : 'smooth' });
  const reveal = button => {
    const container = track.current.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    const left = item.left < container.left ? item.left - container.left : item.right > container.right ? item.right - container.right : 0;
    if (left) track.current.scrollBy({ left, behavior: reducedMotion ? 'auto' : 'smooth' });
  };
  return <Box>
    <HStack justify="space-between" mb={2}>
      <Text fontSize="sm" color="gray.500">Swipe or scroll to browse funds</Text>
      <HStack>
        <IconButton aria-label="Previous funds" icon={<FaChevronLeft />} onClick={() => scroll(-1)} isDisabled={edges.start} />
        <IconButton aria-label="Next funds" icon={<FaChevronRight />} onClick={() => scroll(1)} isDisabled={edges.end} />
      </HStack>
    </HStack>
    <HStack ref={track} role="group" aria-label="Funds" overflowX="auto" align="stretch" spacing={3} py={2} px={1}
      sx={{ scrollSnapType: 'x mandatory', overscrollBehaviorX: 'contain' }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const buttons = [...track.current.querySelectorAll('button')];
        const index = buttons.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))].focus();
      }}>
      {funds.map(fund => {
        const state = states.get(fund.id);
        const children = allFunds.filter(child => child.parentId === fund.id && Boolean(child.archivedAt) === Boolean(fund.archivedAt));
        const status = allocationStatus(fund, state);
        const childAutos = children.filter(child => child.active && child.allocationMode === 'scheduled' && child.periodType !== 'all-time').length;
        const remaining = fund.archivedAt ? fund.archivedRemainingCents : state?.remainingCents;
        return <Button key={fund.id} variant="outline" color={textColor} fontWeight="normal" height="auto" minW={0} flex="0 0 220px" maxW="220px"
          p={3} whiteSpace="normal" textAlign="left" display="block" borderWidth="2px" borderColor={selectedId === fund.id ? 'blue.400' : 'transparent'}
          bg={selectedId === fund.id ? selectedBg : bg} _hover={{ bg: selectedBg }} _active={{ bg: selectedBg, color: textColor }} boxShadow="sm" aria-pressed={selectedId === fund.id}
          sx={{ scrollSnapAlign: 'start' }} onFocus={event => reveal(event.currentTarget)} onClick={event => { reveal(event.currentTarget); onSelect(fund.id); }}>
          <HStack justify="space-between" align="start" spacing={2}><Text fontSize="sm" fontWeight="bold" overflowWrap="anywhere">{fund.name}</Text>
          <Badge fontSize="10px" colorScheme={{ reserved: 'purple', sinking: 'green', operating: 'blue' }[fund.fundType]}>{fund.fundType}</Badge></HStack>
          <Text fontSize="xl" fontWeight="bold" mt={1}>{money(remaining)}</Text>
          <Text fontSize="10px" color="gray.500" mb={1}>{fund.archivedAt ? 'Balance at archive' : 'Reserved overall'}{children.length ? ` · ${children.length} sub-fund${children.length === 1 ? '' : 's'}` : ''}</Text>
          <Text fontSize="xs">{fund.targetCents == null ? 'No goal set' : `${children.length ? 'Parent goal' : 'Goal'} ${money(fund.targetCents)}`}</Text>
          {fund.targetCents != null && <Progress aria-label={`${fund.name} goal progress`} mt={2} size="xs" value={fund.targetCents > 0 ? Math.min(100, (state?.ownRemainingCents ?? remaining ?? 0) / fund.targetCents * 100) : 100} />}
          <Badge fontSize="10px" mt={1} colorScheme={status.color} whiteSpace="normal">{status.label}</Badge>
          {childAutos > 0 && <Text mt={1} fontSize="10px" color="gray.500">{childAutos} sub-fund schedule{childAutos === 1 ? '' : 's'} enabled</Text>}
        </Button>;
      })}
    </HStack>
  </Box>;
};
export default FundCarousel;
