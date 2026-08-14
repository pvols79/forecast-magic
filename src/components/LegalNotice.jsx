import { Box, Text as ChakraText } from '@chakra-ui/react';

const LegalNotice = () => {
  const currentYear = new Date().getFullYear();

  return (
    <Box textAlign="center" fontSize="sm" color="gray.500">
      <ChakraText mb={2}>
        <strong>Independent software:</strong> Forecast Magic is not affiliated with, endorsed by, or officially connected with Lunch Money or its developers. Lunch Money trademarks and copyrights belong to their respective owners.
      </ChakraText>
      <ChakraText mb={2}>
        <strong>Use at Your Own Risk:</strong> This application is provided "as is", without warranty of any kind, express or implied. In no event shall the authors or copyright holders be liable for any claim, damages or other liability.
      </ChakraText>
      <ChakraText mb={2}>
        <strong>Privacy:</strong> Your Lunch Money API key and Fund Allocation settings stay within your self-hosted installation. Financial data is sent only between this application and Lunch Money.
      </ChakraText>
      <ChakraText>
        &copy; {currentYear} Forecast Magic contributors. Released under the MIT License.
      </ChakraText>
    </Box>
  );
};

export default LegalNotice;
