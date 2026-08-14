import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Box, useColorModeValue } from '@chakra-ui/react';
import { formatCurrency } from '../utils';
import { format, parse } from 'date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const parseChartDate = (date) => parse(date, 'yyyy-MM-dd', new Date());

const formatAxisCurrency = value => {
  const numericValue = Number(value);
  if (Math.abs(numericValue) >= 1000) {
    const prefix = numericValue < 0 ? '-$' : '$';
    const compactValue = Math.abs(numericValue) / 1000;
    return `${prefix}${Number.isInteger(compactValue) ? compactValue : compactValue.toFixed(1)}K`;
  }
  return formatCurrency(numericValue);
};

const formatXAxisLabel = (labels, index) => {
  const date = labels[index];
  if (!date) return '';

  const parsedDate = parseChartDate(date);
  const isShortRange = labels.length <= 45;

  if (isShortRange) {
    return index % 4 === 0 || index === labels.length - 1 ? format(parsedDate, 'MMM d') : '';
  }

  if (index === 0) {
    const firstMonth = parsedDate.getMonth();
    const nextMonthIndex = labels.findIndex(label => parseChartDate(label).getMonth() !== firstMonth);
    return nextMonthIndex >= 24 || nextMonthIndex === -1 ? format(parsedDate, 'MMM') : '';
  }

  const previousDate = labels[index - 1];
  const previousMonth = previousDate ? parseChartDate(previousDate).getMonth() : null;
  return parsedDate.getMonth() !== previousMonth ? format(parsedDate, 'MMM') : '';
};

const transactionSections = [
  { title: 'Pending Activity', types: ['pending'] },
  { title: 'Scheduled Transactions', types: ['future', 'local'] },
  { title: 'Recurring Forecast', types: ['recurring-projected'] },
  { title: 'Posted Activity', types: ['actual'] },
];

const formatEventAmount = event => `${event.amount > 0 ? '+' : ''}${formatCurrency(parseFloat(event.amount))}`;

const openingAdjustmentLabel = event => event.type === 'recurring-projected'
  ? 'Missed recurring'
  : event.lunchMoneySource === 'recurring'
    ? 'Manual recurring transaction'
    : 'Opening adjustment';

const CashFlowChart = ({ data, keyEvents, projectionDays = [], openingBalance, showOpeningDetails = false }) => {
  const bg = useColorModeValue('white', 'gray.700');
  const positiveFillColor = useColorModeValue('rgba(66, 153, 225, 0.2)', 'rgba(144, 205, 244, 0.2)');
  const negativeFillColor = useColorModeValue('rgba(229, 62, 62, 0.2)', 'rgba(235, 100, 100, 0.2)');
  const positiveBorderColor = useColorModeValue('#4299E1', '#90CDF4');
  const negativeBorderColor = useColorModeValue('rgb(229, 62, 62)', 'rgb(235, 100, 100)');
  const recurringIncomePointColor = useColorModeValue('#38A169', '#68D391');
  const neutralSegmentColor = useColorModeValue('#A0AEC0', '#718096');
  const axisTextColor = useColorModeValue('#4A5568', '#CBD5E0');
  const gridColor = useColorModeValue('rgba(74, 85, 104, 0.16)', 'rgba(203, 213, 224, 0.16)');

  const hasRecurringIncome = (date) => keyEvents.some(event =>
    event.date === date &&
    !event.is_subtotal &&
    parseFloat(event.amount) > 0 &&
    (event.type === 'recurring-projected' || event.recurringId != null)
  );

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: 'index',
    },
    layout: {
      padding: { top: 4, right: 4, bottom: 0, left: 0 },
    },
    plugins: {
      legend: {
        display: false,
        onClick: null,
      },
      title: {
        display: false, // Hide default title, use Chakra Heading instead
      },
      tooltip: {
        callbacks: {
          title: function(context) {
            return context[0].label;
          },
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            if (context.parsed.y !== null) {
              label += formatCurrency(context.parsed.y);
            }
            return label;
          },
          afterLabel: function(context) {
            const date = context.label;
            const transactionsForDate = keyEvents.filter(event => event.date === date && !event.is_subtotal);
            const projectionDay = projectionDays.find(day => day.date === date);
            const operationalFunds = projectionDay?.operationalFunds || [];
            const boundaryAnnotations = projectionDay?.operationalFundAnnotations || [];
            const details = [];
            if (showOpeningDetails && openingBalance?.date === date) {
              details.push('', 'Opening Reconciliation');
              details.push(`Synced account balance: ${formatCurrency(openingBalance.syncedAccountBalance)}`);
              if (openingBalance.adjustmentEvents.length > 0) {
                details.push('', 'Opening Adjustments');
                openingBalance.adjustmentEvents.forEach(event => {
                  details.push(`${event.description} (${openingAdjustmentLabel(event)}): ${formatEventAmount(event)}`);
                });
                details.push(`Net adjustments: ${formatEventAmount({ amount: openingBalance.adjustmentTotal })}`);
              } else {
                details.push('Opening adjustments: $0.00');
              }
              details.push(`Adjusted opening ledger: ${formatCurrency(openingBalance.ledgerBalance)}`);
              if (openingBalance.anchorDateEvents.length > 0) {
                details.push(`Today's forecast activity: ${formatEventAmount({ amount: openingBalance.anchorDateEventTotal })}`);
              }
              details.push(`Projected ledger today: ${formatCurrency(openingBalance.projectedLedgerBalance)}`);
              details.push(`Fund Allocations reserved: -${formatCurrency(openingBalance.reservedOperationalFunds)}`);
              details.push(`Available to Spend: ${formatCurrency(openingBalance.availableToSpend)}`);
            }
            transactionSections.forEach(section => {
              const matchingEvents = transactionsForDate.filter(event => section.types.includes(event.type));
              if (matchingEvents.length === 0) return;
              details.push('', section.title);
              matchingEvents.forEach(event => details.push(`${event.description}: ${formatEventAmount(event)}`));
            });
            const uncategorizedEvents = transactionsForDate.filter(event =>
              !transactionSections.some(section => section.types.includes(event.type))
            );
            if (uncategorizedEvents.length > 0) {
              details.push('', 'Account Activity');
              uncategorizedEvents.forEach(event => details.push(`${event.description}: ${formatEventAmount(event)}`));
            }
            if (operationalFunds.length > 0) {
              details.push('', 'Fund Allocations');
              operationalFunds.forEach(fund => {
                details.push(`${fund.name}: ${formatCurrency(fund.remainingCents / 100)} remaining this period`);
                if (fund.projectedReserveCents !== fund.remainingCents) {
                  details.push(`${formatCurrency(fund.projectedReserveCents / 100)} committed through this date`);
                }
              });
            }
            if (boundaryAnnotations.length > 0) {
              details.push('', 'Period Changes');
              boundaryAnnotations.forEach(annotation => {
                details.push(`${annotation.name}: ${formatCurrency(annotation.allocationCents / 100)} new allocation`);
                if (annotation.carryInCents > 0) details.push(`${formatCurrency(annotation.carryInCents / 100)} rolled forward`);
                details.push(`${formatCurrency(annotation.resultingRemainingCents / 100)} available for this period`);
                if (annotation.projectedReserveCents !== annotation.resultingRemainingCents) {
                  details.push(`${formatCurrency(annotation.projectedReserveCents / 100)} committed through this date`);
                }
              });
            }
            return details;
          }
        }
      }
    },
    scales: {
      x: {
        ticks: {
          autoSkip: false,
          color: axisTextColor,
          maxRotation: 0,
          callback: function(value, index) {
            return formatXAxisLabel(this.chart.data.labels, index);
          },
        },
        grid: {
          color: gridColor,
        },
      },
      y: {
        beginAtZero: true,
        ticks: {
          callback: value => formatAxisCurrency(value),
          color: axisTextColor,
          maxTicksLimit: 7,
        },
        grid: {
          color: gridColor,
        },
      }
    },
    animation: {
      duration: 250,
    },
  };

  const chartData = {
    labels: data.labels,
    datasets: data.datasets.map(dataset => ({
      ...dataset,
      fill: {
        target: 'origin',
        above: positiveFillColor,
        below: negativeFillColor,
      },
      segment: {
        borderColor: neutralSegmentColor,
      },
      pointBackgroundColor: context => {
        const date = context.chart.data.labels[context.dataIndex];
        if (hasRecurringIncome(date)) {
          return recurringIncomePointColor;
        }
        const value = context.parsed && context.parsed.y !== undefined ? context.parsed.y : 0;
        return value >= 0 ? positiveBorderColor : negativeBorderColor;
      },
      pointBorderColor: context => {
        const date = context.chart.data.labels[context.dataIndex];
        if (hasRecurringIncome(date)) {
          return recurringIncomePointColor;
        }
        const value = context.parsed && context.parsed.y !== undefined ? context.parsed.y : 0;
        return value >= 0 ? positiveBorderColor : negativeBorderColor;
      },
      pointRadius: context => {
        const date = context.chart.data.labels[context.dataIndex];
        const hasTransactions = keyEvents.some(event => event.date === date && !event.is_subtotal);
        const hasFundBoundary = projectionDays.some(day => day.date === date && day.operationalFundAnnotations?.length > 0);
        return hasRecurringIncome(date) ? 5 : (hasTransactions || hasFundBoundary ? 3 : 0);
      },
      pointHitRadius: context => {
        const date = context.chart.data.labels[context.dataIndex];
        const hasTransactions = keyEvents.some(event => event.date === date && !event.is_subtotal);
        const hasFunds = projectionDays.some(day => day.date === date && day.operationalFunds?.length > 0);
        return hasTransactions || hasFunds ? 6 : 0;
      },
    })),
  };

  return (
    <Box
      w="100%"
      h={{ base: '300px', md: '340px', xl: '360px' }}
      bg={bg}
      px={{ base: 2, md: 4 }}
      py={3}
      position="relative"
    >
      <Line options={options} data={chartData} key={JSON.stringify(chartData.datasets)} />
    </Box>
  );
};

export default CashFlowChart;
