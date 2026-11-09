import { useState } from 'react';
import { Button, Menu, MenuButton, MenuItem, MenuList, useToast } from '@chakra-ui/react';
import { FaChevronDown, FaDownload, FaPrint, FaShareAlt } from 'react-icons/fa';
import { getApiErrorMessage, getDailyHighlightPdf } from '../backendApi.js';
import { downloadPdf, printPdf, reportRequest, shareOrDownloadPdf } from '../reportSharing.js';

const ShareReportButton = ({ accountKey, view }) => {
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleReportAction = async action => {
    setLoading(true);
    try {
      const request = reportRequest(accountKey, view);
      const fetchReport = () => getDailyHighlightPdf(request.accountKey, request.view);
      let result;
      if (action === 'download') {
        result = await downloadPdf({ filename: `forecast-magic-${request.view}.pdf`, getFile: fetchReport });
      } else {
        const reportFile = await fetchReport();
        result = action === 'print' ? await printPdf(reportFile) : await shareOrDownloadPdf(reportFile);
      }
      if (result === 'saved') {
        toast({ status: 'success', title: 'Report saved', duration: 2500 });
      } else if (result === 'downloaded') {
        toast({ status: 'success', title: 'Report downloaded', duration: 2500 });
      } else if (result === 'printing') {
        toast({ status: 'success', title: 'Print dialog opened', duration: 2500 });
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        toast({ status: 'error', title: 'Unable to generate report', description: getApiErrorMessage(error) });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Menu>
      <MenuButton
        as={Button}
        size="sm"
        variant="outline"
        leftIcon={<FaShareAlt />}
        rightIcon={<FaChevronDown />}
        isLoading={loading}
        loadingText="Generating"
      >
        Share Report
      </MenuButton>
      <MenuList>
        <MenuItem icon={<FaShareAlt />} onClick={() => handleReportAction('share')}>
          Share PDF
        </MenuItem>
        <MenuItem icon={<FaDownload />} onClick={() => handleReportAction('download')}>
          Download PDF
        </MenuItem>
        <MenuItem icon={<FaPrint />} onClick={() => handleReportAction('print')}>
          Print PDF
        </MenuItem>
      </MenuList>
    </Menu>
  );
};

export default ShareReportButton;
