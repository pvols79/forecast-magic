import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Badge, Box, Heading, HStack, IconButton, Text as ChakraText,
  useColorModeValue, usePrefersReducedMotion,
} from '@chakra-ui/react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { formatCurrency } from '../utils';
import { selectUpcomingEvents } from '../upcomingEvents';
import { differenceInCalendarDays, format, parse } from 'date-fns';

const formatEventDate = (date) => {
  const parsedDate = parse(date, 'yyyy-MM-dd', new Date());
  const daysAway = differenceInCalendarDays(parsedDate, new Date());

  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  if (daysAway === -1) return 'Yesterday';
  if (daysAway > 1 && daysAway <= 7) return `In ${daysAway} days`;
  if (daysAway < -1 && daysAway >= -7) return `${Math.abs(daysAway)} days ago`;

  return format(parsedDate, 'MMM d, yyyy');
};

const formatPastDueDate = (date) => {
  const parsedDate = parse(date, 'yyyy-MM-dd', new Date());
  const daysPastDue = Math.max(0, differenceInCalendarDays(new Date(), parsedDate));

  if (daysPastDue === 0) return 'Due today';
  if (daysPastDue === 1) return '1 day past due';
  return `${daysPastDue} days past due`;
};

const getLocalDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getEventStatus = event => {
  if (event.is_historical_missed) return { label: 'Past due', scheme: 'orange' };
  if (event.type === 'recurring-projected') return { label: 'Recurring', scheme: 'blue' };
  if (event.type === 'pending') return { label: 'Pending', scheme: 'yellow' };
  if (event.type === 'future') return { label: 'Scheduled', scheme: 'purple' };
  return null;
};

const KeyEventCard = ({ event }) => {
  const cardBg = useColorModeValue('white', 'gray.700');
  const mutedColor = useColorModeValue('gray.600', 'gray.300');
  const incomeColor = useColorModeValue('green.600', 'green.300');
  const expenseColor = useColorModeValue('red.600', 'red.300');
  const amount = event.amount;
  const status = getEventStatus(event);
  const relativeDate = event.is_historical_missed ? formatPastDueDate(event.date) : formatEventDate(event.date);
  const absoluteDate = format(parse(event.date, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy');

  return (
    <Box bg={cardBg} borderRadius="md" borderWidth="1px" p={2.5} minH="116px" h="100%">
      <HStack justify="space-between" align="start" mb={1.5}>
        <Box minW={0}>
          <ChakraText fontSize="sm" fontWeight="medium" color={mutedColor}>
            {relativeDate}
          </ChakraText>
          {relativeDate !== absoluteDate && (
            <ChakraText fontSize="xs" color={mutedColor}>{absoluteDate}</ChakraText>
          )}
        </Box>
        {status && <Badge fontSize="0.65rem" colorScheme={status.scheme}>{status.label}</Badge>}
      </HStack>
      <ChakraText fontSize="sm" fontWeight="bold" lineHeight="short" minH="34px" noOfLines={2}>
        {event.description}
      </ChakraText>
      <HStack justify="space-between" align="end" mt={1.5}>
        <ChakraText fontSize="sm" color={amount >= 0 ? incomeColor : expenseColor} fontWeight="semibold">
          {amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(amount))}
        </ChakraText>
        {typeof event.balance === 'number' && (
          <Box textAlign="right">
            <ChakraText fontSize="xs" color={mutedColor}>Balance</ChakraText>
            <ChakraText fontSize="sm" fontWeight="semibold">{formatCurrency(event.balance)}</ChakraText>
          </Box>
        )}
      </HStack>
    </Box>
  );
};

const KeyEventCarousel = ({ events, historicalMissedEvents }) => {
  const track = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const [position, setPosition] = useState({ start: 0, end: 0, atStart: true, atEnd: false });
  const carouselEvents = useMemo(() => {
    const today = getLocalDateString(new Date());
    return selectUpcomingEvents(events, historicalMissedEvents, today);
  }, [events, historicalMissedEvents]);
  const bg = useColorModeValue('gray.50', 'gray.800');
  const mutedColor = useColorModeValue('gray.600', 'gray.300');

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => {
      const viewport = element.getBoundingClientRect();
      const visible = [...element.children].map((child, index) => ({ rect: child.getBoundingClientRect(), index }))
        .filter(({ rect }) => rect.right > viewport.left + 8 && rect.left < viewport.right - 8);
      setPosition({ start: visible[0]?.index || 0, end: (visible.at(-1)?.index ?? -1) + 1,
        atStart: element.scrollLeft <= 8, atEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 8 });
    };
    element.scrollLeft = 0;
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { element.removeEventListener('scroll', update); observer.disconnect(); };
  }, [carouselEvents]);
  const scroll = direction => track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.8, behavior: reducedMotion ? 'auto' : 'smooth' });

  if (!carouselEvents || carouselEvents.length === 0) return null;

  return (
    <Box w="100%" bg={bg} borderTopWidth="1px" px={{ base: 4, lg: 5 }} py={4}>
      <HStack justify="space-between" mb={3}>
        <HStack spacing={2}>
          <Heading size="sm">Upcoming</Heading>
          <Badge variant="subtle">{carouselEvents.length}</Badge>
        </HStack>
        <HStack spacing={1}>
          <IconButton
            aria-label="Previous key events"
            icon={<FaChevronLeft />}
            onClick={() => scroll(-1)}
            isDisabled={position.atStart}
            size="sm"
            variant="outline"
          />
          <IconButton
            aria-label="Next key events"
            icon={<FaChevronRight />}
            onClick={() => scroll(1)}
            isDisabled={position.atEnd}
            size="sm"
            variant="outline"
          />
        </HStack>
      </HStack>
      <ChakraText fontSize="xs" color={mutedColor} mb={2}>Swipe or scroll to browse upcoming activity</ChakraText>
      <HStack ref={track} role="region" aria-label="Upcoming activity" overflowX="auto" align="stretch" spacing={2.5} py={1}
        tabIndex={0} sx={{ scrollSnapType: 'x mandatory', overscrollBehaviorX: 'contain' }}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); scroll(event.key === 'ArrowLeft' ? -1 : 1); }
        }}>
        {carouselEvents.map((event, index) => (
          <Box key={`${event.id || event.transactionId || event.recurringId || ''}:${event.date}:${index}`}
            flex={{ base: '0 0 85%', sm: '0 0 44%', md: '0 0 30%', lg: '0 0 18%', '2xl': '0 0 15%' }} minW={0}
            sx={{ scrollSnapAlign: 'start' }}>
            <KeyEventCard event={event} />
          </Box>
        ))}
      </HStack>
      <ChakraText mt={2} fontSize="xs" color={mutedColor} textAlign="right">
        {position.start + 1}-{Math.max(position.start + 1, position.end)} of {carouselEvents.length}
      </ChakraText>
    </Box>
  );
};

const KeyEvents = ({ events, historicalMissedEvents = [] }) => (
  <KeyEventCarousel events={events} historicalMissedEvents={historicalMissedEvents} />
);

export default KeyEvents;
