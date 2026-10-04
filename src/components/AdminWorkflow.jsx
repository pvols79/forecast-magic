import { useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, Heading, HStack, Text as ChakraText,
  VStack, useColorModeValue,
} from '@chakra-ui/react';
import { FaBroom, FaCheckCircle, FaSearch } from 'react-icons/fa';
import {
  clearRecurringSuggestions, getApiErrorMessage, getRecurringSuggestions, reviewDeletedPendingTransactions,
} from '../backendApi';
import { formatCurrency } from '../utils';

const Step = ({ number, title, description, children }) => (
  <Flex
    borderWidth="1px"
    borderRadius="md"
    px={3}
    py={3}
    align="center"
    justify="space-between"
    gap={3}
    wrap="wrap"
  >
    <HStack align="start" spacing={3} flex="1 1 260px">
      <Badge colorScheme="magic" borderRadius="full" minW="1.6rem" textAlign="center">{number}</Badge>
      <Box>
        <ChakraText fontWeight="semibold" lineHeight="1.2">{title}</ChakraText>
        <ChakraText fontSize="xs" color="gray.500">{description}</ChakraText>
      </Box>
    </HStack>
    <HStack spacing={2}>{children}</HStack>
  </Flex>
);

const AdminWorkflow = ({ accountKey, onRefresh, onRunDuplicates }) => {
  const [runningAction, setRunningAction] = useState(null);
  const [message, setMessage] = useState(null);
  const [recurringPreview, setRecurringPreview] = useState(null);
  const panelBg = useColorModeValue('white', 'gray.700');

  const runAction = async (action, run, successText) => {
    setRunningAction(action);
    setMessage(null);
    try {
      const result = await run();
      setMessage({ status: 'success', text: successText(result) });
      await onRefresh();
    } catch (error) {
      setMessage({ status: 'error', text: getApiErrorMessage(error) });
    } finally {
      setRunningAction(null);
    }
  };

  const previewRecurringSuggestions = async () => {
    setRunningAction('recurring-preview');
    setMessage(null);
    try {
      const result = await getRecurringSuggestions(accountKey);
      setRecurringPreview(result);
      setMessage({
        status: result.count === 0 ? 'success' : 'info',
        text: result.count === 0
          ? 'No visible recurring suggestions with linked transactions found for this account.'
          : `Found ${result.count} recurring suggestion${result.count === 1 ? '' : 's'} with linked transactions to review.`,
      });
    } catch (error) {
      setMessage({ status: 'error', text: getApiErrorMessage(error) });
    } finally {
      setRunningAction(null);
    }
  };

  const clearPreviewedRecurringSuggestions = async () => {
    const transactionIds = recurringPreview?.suggestions?.flatMap(suggestion => suggestion.transactionIds) || [];
    await runAction(
      'recurring-clear',
      () => clearRecurringSuggestions(accountKey, transactionIds),
      result => `Cleared ${result.cleared} transaction recurring link${result.cleared === 1 ? '' : 's'} from ${result.suggestionCount} visible suggestion${result.suggestionCount === 1 ? '' : 's'}.`
    );
    setRecurringPreview(null);
  };

  return (
    <Box bg={panelBg} borderRadius="md" borderWidth="1px" boxShadow="sm" overflow="hidden">
      <Flex px={{ base: 4, lg: 5 }} py={3} justify="space-between" align="center" gap={3} wrap="wrap">
        <Box>
          <Heading size="sm">Admin Workflow</Heading>
          <ChakraText fontSize="xs" color="gray.500">
            Run these in order before trusting the selected account forecast.
          </ChakraText>
        </Box>
        <Badge colorScheme="blue" variant="subtle">Selected account</Badge>
      </Flex>

      {message && <Alert status={message.status} mx={4} mb={3} py={2}><AlertIcon />{message.text}</Alert>}

      <VStack align="stretch" spacing={3} px={{ base: 4, lg: 5 }} pb={4}>
        <Step
          number="1"
          title="Keep Deleted Pending"
          description="Marks Lunch Money deleted-pending transactions as reviewed."
        >
          <Button
            size="sm"
            leftIcon={<FaCheckCircle />}
            onClick={() => runAction(
              'deleted-pending',
              () => reviewDeletedPendingTransactions(accountKey),
              result => result.reviewed === 0
                ? 'No deleted-pending transactions found for this account.'
                : `Marked ${result.reviewed} deleted-pending transaction${result.reviewed === 1 ? '' : 's'} as reviewed.`
            )}
            isLoading={runningAction === 'deleted-pending'}
            isDisabled={Boolean(runningAction)}
          >
            Run
          </Button>
        </Step>

        <Step
          number="2"
          title="Clear Recurring Suggestions"
          description="Preview visible suggestions for this account, then clear their linked transactions."
        >
          <Button
            size="sm"
            leftIcon={<FaBroom />}
            onClick={previewRecurringSuggestions}
            isLoading={runningAction === 'recurring-preview'}
            isDisabled={Boolean(runningAction)}
          >
            Preview
          </Button>
        </Step>
        {recurringPreview?.suggestions?.length > 0 && (
          <Box borderWidth="1px" borderRadius="md" px={3} py={3}>
            <VStack align="stretch" spacing={2}>
              {recurringPreview.suggestions.map(suggestion => (
                <Flex key={suggestion.id} justify="space-between" gap={3} wrap="wrap">
                  <Box>
                    <ChakraText fontWeight="semibold">{suggestion.payee}</ChakraText>
                    <ChakraText fontSize="xs" color="gray.500">
                      {formatCurrency(-Math.abs(suggestion.amount))} · {suggestion.transactionIds.length} linked transaction{suggestion.transactionIds.length === 1 ? '' : 's'}
                    </ChakraText>
                  </Box>
                  <Badge alignSelf="center" colorScheme="orange">Suggestion #{suggestion.id}</Badge>
                </Flex>
              ))}
              <HStack justify="flex-end" pt={1}>
                <Button size="sm" variant="ghost" onClick={() => setRecurringPreview(null)} isDisabled={Boolean(runningAction)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  colorScheme="orange"
                  onClick={clearPreviewedRecurringSuggestions}
                  isLoading={runningAction === 'recurring-clear'}
                  isDisabled={Boolean(runningAction)}
                >
                  Confirm Clear
                </Button>
              </HStack>
            </VStack>
          </Box>
        )}

        <Step
          number="3"
          title="Duplicate Review"
          description="Scan and resolve manual/API placeholders against imported transactions."
        >
          <Button
            size="sm"
            leftIcon={<FaSearch />}
            onClick={onRunDuplicates}
            isDisabled={Boolean(runningAction)}
          >
            Check
          </Button>
        </Step>
      </VStack>
    </Box>
  );
};

export default AdminWorkflow;
