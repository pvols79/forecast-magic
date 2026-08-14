import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Box, Heading, HStack, IconButton, SimpleGrid, Text as ChakraText,
  useBreakpointValue, useColorModeValue,
} from '@chakra-ui/react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { formatCurrency } from '../utils';
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
    <Box bg={cardBg} borderRadius="md" borderWidth="1px" p={2.5} minH="116px">
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
  const [startIndex, setStartIndex] = useState(0);
  const visibleCount = useBreakpointValue({ base: 1, sm: 2, md: 3, lg: 5, '2xl': 6 }, { fallback: 'lg' }) || 5;
  const carouselEvents = useMemo(() => {
    const today = getLocalDateString(new Date());
    const futureEvents = events.filter(event =>
      event.date > today &&
      !event.is_subtotal
    );
    const missedEvents = (historicalMissedEvents || []).map(event => ({
      ...event,
      balance: undefined,
      is_historical_missed: true,
    }));

    return [...missedEvents, ...futureEvents].sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [events, historicalMissedEvents]);
  const visibleEvents = useMemo(
    () => carouselEvents.slice(startIndex, startIndex + visibleCount),
    [carouselEvents, startIndex, visibleCount]
  );
  const canGoBack = startIndex > 0;
  const canGoForward = startIndex + visibleCount < carouselEvents.length;
  const bg = useColorModeValue('gray.50', 'gray.800');
  const mutedColor = useColorModeValue('gray.600', 'gray.300');

  useEffect(() => {
    const lastStartIndex = Math.max(0, carouselEvents.length - visibleCount);
    if (startIndex > lastStartIndex) setStartIndex(lastStartIndex);
  }, [carouselEvents.length, startIndex, visibleCount]);

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
            onClick={() => setStartIndex(index => Math.max(0, index - visibleCount))}
            isDisabled={!canGoBack}
            size="sm"
            variant="outline"
          />
          <IconButton
            aria-label="Next key events"
            icon={<FaChevronRight />}
            onClick={() => setStartIndex(index => Math.min(
              Math.max(0, carouselEvents.length - visibleCount),
              index + visibleCount
            ))}
            isDisabled={!canGoForward}
            size="sm"
            variant="outline"
          />
        </HStack>
      </HStack>
      <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 5, '2xl': 6 }} spacing={2.5}>
        {visibleEvents.map((event, index) => (
          <KeyEventCard key={`${event.date}-${event.description}-${startIndex + index}`} event={event} />
        ))}
      </SimpleGrid>
      <ChakraText mt={2} fontSize="xs" color={mutedColor} textAlign="right">
        {startIndex + 1}-{Math.min(startIndex + visibleCount, carouselEvents.length)} of {carouselEvents.length}
      </ChakraText>
    </Box>
  );
};

const KeyEvents = ({ events, historicalMissedEvents = [] }) => (
  <KeyEventCarousel events={events} historicalMissedEvents={historicalMissedEvents} />
);

export default KeyEvents;
