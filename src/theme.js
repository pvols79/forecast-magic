import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
  config: {
    initialColorMode: 'system',
    useSystemColorMode: true,
  },
  colors: {
    magic: {
      50: '#f6f3ff',
      100: '#ede7ff',
      200: '#d9ccff',
      300: '#b99cff',
      400: '#9364f4',
      500: '#7138d0',
      600: '#5725aa',
      700: '#3d1d7a',
      800: '#21184f',
      900: '#0b1233',
    },
    brand: {
      900: '#1a202c',
      800: '#2d3748',
      700: '#4a5568',
      600: '#718096',
      500: '#a0aec0',
      400: '#cbd5e0',
      300: '#e2e8f0',
      200: '#edf2f7',
      100: '#f7fafc',
    },
  },
  styles: {
    global: {
      'button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, [tabindex]:focus-visible': {
        outline: '2px solid',
        outlineColor: 'blue.400',
        outlineOffset: '2px',
      },
    },
  },
  components: {
    Button: {
      baseStyle: {
        fontWeight: 'bold',
      },
      variants: {
        solid: (props) => ({
          bg: props.colorMode === 'dark' ? 'blue.300' : 'blue.500',
          color: 'white',
          _hover: {
            bg: props.colorMode === 'dark' ? 'blue.400' : 'blue.600',
          },
        }),
      },
    },
  },
});

export default theme;
