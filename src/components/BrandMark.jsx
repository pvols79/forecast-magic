import { Box, Image } from '@chakra-ui/react';

const BrandMark = ({ size = 42 }) => (
  <Box
    position="relative"
    boxSize={`${size}px`}
    overflow="hidden"
    borderRadius={`${Math.round(size * 0.22)}px`}
    bg="white"
    flexShrink={0}
    boxShadow="sm"
  >
    <Image
      src="/forecast-magic-logo.png"
      alt="Forecast Magic logo"
      position="absolute"
      maxW="none"
      width={`${size * 1.6}px`}
      left={`${size * -0.29}px`}
      top={`${size * -0.02}px`}
    />
  </Box>
);

export default BrandMark;
