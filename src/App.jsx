import { useState, useEffect, useCallback } from 'react';
import {
  Alert, Box, Button, Container, Flex, Heading, HStack, Icon, IconButton, Image,
  SimpleGrid, Spinner, Text as ChakraText, VStack, useColorMode, useColorModeValue,
} from '@chakra-ui/react';
import { MdError } from 'react-icons/md';
import { FaMoon, FaSun } from 'react-icons/fa';
import ApiKeyInput from './components/ApiKeyInput';
import AccountSelector from './components/AccountSelector';
import ProjectionHorizonSelector from './components/ProjectionHorizonSelector';
import CashFlowChart from './components/CashFlowChart';
import KeyEvents from './components/KeyEvents';
import NegativeBalanceAlerts from './components/NegativeBalanceAlerts';
import LegalNotice from './components/LegalNotice';
import AdminMetrics from './components/AdminMetrics';
import HouseholdFundSummaries from './components/HouseholdFundSummaries';
import ViewModeControl from './components/ViewModeControl';
import BrandMark from './components/BrandMark';
import OperationalFundsManager from './components/operational-funds/OperationalFundsManager';
import { getAccounts, getRecurringItems, getPlaidAccounts, getTransactions } from './lunchmoney';
import { projectCashFlow } from './projection';
import { applyOperationalFunds } from './availableToSpend';
import {
  clearApiKey, getApiErrorMessage, getAuthStatus, getOperationalFundProjection,
  getSettings, loginAdmin, logoutAdmin, saveApiKey, updateTimezone,
} from './backendApi';

const getDateInTimezone = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const addMonths = (dateString, months) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};

const recurringLookback = dateString => {
  const [year, month] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 4, 1)).toISOString().slice(0, 10);
};

function App() {
  const [authStatus, setAuthStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(() => localStorage.getItem('lm_selected_account_id'));
  const [projectionHorizon, setProjectionHorizon] = useState(() => {
    const storedHorizon = localStorage.getItem('lm_projection_horizon');
    return storedHorizon ? parseInt(storedHorizon, 10) : 3;
  });
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fundRefresh, setFundRefresh] = useState(0);
  const { colorMode, toggleColorMode } = useColorMode();

  const bg = useColorModeValue('brand.100', 'brand.900');
  const headerBg = useColorModeValue('brand.200', 'brand.800');
  const panelBg = useColorModeValue('white', 'gray.700');

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      try {
        const [nextAuthStatus, nextSettings] = await Promise.all([getAuthStatus(), getSettings()]);
        let timezone = nextSettings.timezone;
        if (!timezone) {
          timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          await updateTimezone(timezone);
        }
        setAuthStatus(nextAuthStatus);
        setIsAdminView(nextAuthStatus.isAdmin);
        setSettings({ ...nextSettings, timezone });
      } catch (initializationError) {
        setError(`Unable to connect to the local application server. ${getApiErrorMessage(initializationError)}`);
      } finally {
        setLoading(false);
      }
    };
    initialize();
  }, []);

  useEffect(() => {
    if (selectedAccountId) localStorage.setItem('lm_selected_account_id', selectedAccountId);
    else localStorage.removeItem('lm_selected_account_id');
  }, [selectedAccountId]);

  useEffect(() => {
    localStorage.setItem('lm_projection_horizon', projectionHorizon.toString());
  }, [projectionHorizon]);

  useEffect(() => {
    if (!settings?.apiKeyConfigured) return;
    setLoading(true);
    setError(null);
    Promise.all([getAccounts(), getPlaidAccounts()])
      .then(([manualAccounts, plaidAccounts]) => {
        const allAccounts = [...manualAccounts, ...plaidAccounts];
        setAccounts(allAccounts);
        const storedAccountId = localStorage.getItem('lm_selected_account_id');
        const storedAccount = storedAccountId
          ? allAccounts.find(account => account.key === storedAccountId || String(account.id) === storedAccountId)
          : null;
        setSelectedAccountId(storedAccount?.key || allAccounts[0]?.key || null);
      })
      .catch(accountError => setError(`Error fetching data from Lunch Money. ${getApiErrorMessage(accountError)}`))
      .finally(() => setLoading(false));
  }, [settings?.apiKeyConfigured]);

  const handleApiKeySubmit = async key => {
    setLoading(true);
    setError(null);
    try {
      await saveApiKey(key);
      setSettings(current => ({ ...current, apiKeyConfigured: true }));
    } catch (apiKeyError) {
      setError(getApiErrorMessage(apiKeyError));
    } finally {
      setLoading(false);
    }
  };

  const handleClearApiKey = async () => {
    try {
      await clearApiKey();
      setSettings(current => ({ ...current, apiKeyConfigured: false }));
      setAccounts([]);
      setSelectedAccountId(null);
      setProjection(null);
      setError(null);
      localStorage.removeItem('lm_selected_account_id');
    } catch (clearError) {
      setError(getApiErrorMessage(clearError));
    }
  };

  const handleLogin = async password => {
    try {
      await loginAdmin(password);
      const nextAuth = await getAuthStatus();
      setAuthStatus(nextAuth);
      setIsAdminView(true);
      setError(null);
    } catch (loginError) {
      setError(getApiErrorMessage(loginError));
    }
  };

  const handleLogout = async () => {
    await logoutAdmin();
    setAuthStatus(await getAuthStatus());
    setIsAdminView(false);
  };

  const handleGenerateProjection = useCallback(async () => {
    if (!selectedAccountId || !projectionHorizon || !settings?.timezone) return;
    setLoading(true);
    setError(null);
    const startDate = getDateInTimezone(new Date(), settings.timezone);
    const endDate = addMonths(startDate, projectionHorizon);

    try {
      const [recurringEvents, transactionEvents, fundProjection] = await Promise.all([
        getRecurringItems(recurringLookback(startDate), endDate),
        getTransactions(recurringLookback(startDate), endDate, startDate),
        getOperationalFundProjection(selectedAccountId, startDate, endDate, !isAdminView),
      ]);
      const ledgerProjection = projectCashFlow(
        accounts,
        [...transactionEvents, ...recurringEvents],
        selectedAccountId,
        projectionHorizon,
        { anchorDate: startDate }
      );
      setProjection(applyOperationalFunds(ledgerProjection, fundProjection));
    } catch (projectionError) {
      setError(`Error generating projection. ${getApiErrorMessage(projectionError)}`);
    } finally {
      setLoading(false);
    }
  }, [accounts, fundRefresh, isAdminView, projectionHorizon, selectedAccountId, settings?.timezone]);

  useEffect(() => {
    if (selectedAccountId && accounts.length > 0) handleGenerateProjection();
  }, [selectedAccountId, accounts, handleGenerateProjection]);

  const selectedAccount = accounts.find(account => account.key === selectedAccountId);
  const chartData = projection ? {
    labels: projection.dailyBalances.map(day => day.date),
    datasets: [{
      label: 'Available to Spend',
      data: projection.dailyBalances.map(day => day.availableBalance),
      borderColor: 'rgb(75, 192, 192)',
      tension: 0.1,
    }],
  } : null;

  return (
    <Box bg={bg} minH="100vh">
      <Box as="header" bg={headerBg} py={2} px={{ base: 4, lg: 6 }} boxShadow="sm" borderBottomWidth="3px" borderBottomColor="magic.500">
        <Flex justify="space-between" align="center" gap={3} wrap="wrap">
          <Flex align="center" gap={3}>
            <BrandMark />
            <Heading as="h1" size="md">Forecast Magic</Heading>
          </Flex>
          <HStack spacing={2}>
            <ViewModeControl
              authStatus={authStatus}
              isAdminView={isAdminView}
              onAdminView={() => setIsAdminView(true)}
              onHouseholdView={() => setIsAdminView(false)}
              onLogin={handleLogin}
              onLogout={handleLogout}
            />
            <IconButton aria-label="Toggle theme" icon={colorMode === 'light' ? <FaMoon /> : <FaSun />} onClick={toggleColorMode} variant="ghost" />
            {settings?.apiKeyConfigured && authStatus?.isAdmin && !settings.apiKeyFromEnvironment && (
              <Button colorScheme="red" onClick={handleClearApiKey}>Clear API Key</Button>
            )}
          </HStack>
        </Flex>
      </Box>

      <Container maxW="1600px" px={{ base: 4, lg: 6 }} py={{ base: 4, lg: 5 }}>
        {error && <Alert status="error" mb={4}><Icon as={MdError} mr={2} />{error}</Alert>}
        {loading && <Spinner size="lg" mb={4} />}

        {settings && !settings.apiKeyConfigured ? (
          <VStack spacing={6} p={8} borderWidth="1px" borderRadius="md" boxShadow="md" bg={panelBg}>
            <Image src="/forecast-magic-logo.png" alt="Forecast Magic" width="240px" maxW="70vw" borderRadius="md" />
            <Heading size="xl" textAlign="center">Welcome to Forecast Magic</Heading>
            {authStatus?.isAdmin ? (
              <>
                <ChakraText fontSize="lg" textAlign="center">Enter your Lunch Money API key to get started.</ChakraText>
                <ApiKeyInput onApiKeySubmit={handleApiKeySubmit} />
                <ChakraText fontSize="sm" color="gray.500" textAlign="center">
                  The key is stored only by this self-hosted application and sent only to Lunch Money.
                </ChakraText>
              </>
            ) : (
              <ChakraText>Use the Admin password in the header to configure Lunch Money.</ChakraText>
            )}
          </VStack>
        ) : settings?.apiKeyConfigured ? (
          <SimpleGrid columns={{ base: 1 }} spacing={4} w="100%">
            <VStack spacing={4} w="100%" align="stretch">
              {accounts.length > 0 && (
                <Box bg={panelBg} borderRadius="md" borderWidth="1px" boxShadow="sm" px={{ base: 4, lg: 5 }} py={3}>
                  <Flex align="end" gap={{ base: 4, lg: 8 }} direction={{ base: 'column', md: 'row' }}>
                    <AccountSelector accounts={accounts} onAccountSelect={setSelectedAccountId} selectedAccountId={selectedAccountId} />
                    <ProjectionHorizonSelector onHorizonSelect={setProjectionHorizon} currentHorizon={projectionHorizon} />
                  </Flex>
                </Box>
              )}
              {accounts.length === 0 && !loading && !error && (
                <ChakraText color="gray.500" textAlign="center">No accounts found.</ChakraText>
              )}
            </VStack>

            {projection ? (
              <VStack spacing={4} w="100%" align="stretch">
                {isAdminView && authStatus?.isAdmin && selectedAccount && (
                  <AdminMetrics openingBalance={projection.openingBalance} />
                )}
                <Box bg={panelBg} borderRadius="md" borderWidth="1px" boxShadow="sm" overflow="hidden">
                  <Box px={{ base: 4, lg: 5 }} pt={4}>
                    <Heading size="md">Cash Flow Projection</Heading>
                  </Box>
                  <CashFlowChart
                    data={chartData}
                    keyEvents={projection.keyEvents}
                    projectionDays={projection.dailyBalances}
                    openingBalance={projection.openingBalance}
                    showOpeningDetails={isAdminView && authStatus?.isAdmin}
                  />
                  <Box px={{ base: 4, lg: 5 }}>
                    <NegativeBalanceAlerts alerts={projection.negativeBalanceAlerts} />
                  </Box>
                  <KeyEvents events={projection.keyEvents} historicalMissedEvents={projection.historicalMissedEvents} />
                </Box>
                {!isAdminView && <HouseholdFundSummaries funds={projection.operationalFunds} />}
                {isAdminView && authStatus?.isAdmin && (
                  <OperationalFundsManager
                    accountKey={selectedAccountId}
                    currentStates={projection.operationalFunds}
                    onChanged={() => setFundRefresh(value => value + 1)}
                  />
                )}
              </VStack>
            ) : (
              <VStack spacing={8} w="100%" align="center" justify="center" minH="300px" borderWidth="1px" borderRadius="md" boxShadow="md" bg={panelBg}>
                <ChakraText fontSize="xl" color="gray.500">Generate a projection to see your cash flow chart and key events.</ChakraText>
              </VStack>
            )}
          </SimpleGrid>
        ) : null}
      </Container>

      <Box as="footer" py={4} px={4} mt={4} textAlign="center"><LegalNotice /></Box>
    </Box>
  );
}

export default App;
