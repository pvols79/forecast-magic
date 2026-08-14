import { HStack, Slider, SliderTrack, SliderFilledTrack, SliderThumb, SliderMark, Tooltip, FormLabel, FormControl, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';

const ProjectionHorizonSelector = ({ onHorizonSelect, currentHorizon }) => {
  const [sliderValue, setSliderValue] = useState(currentHorizon);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => setSliderValue(currentHorizon), [currentHorizon]);

  const handleSliderChange = (val) => {
    setSliderValue(val);
    onHorizonSelect(val);
  };

  return (
    <FormControl flex="1" w="100%" minW={{ md: '340px' }} pb={4}>
      <HStack justify="space-between" mb={1}>
        <FormLabel fontSize="sm" fontWeight="semibold" mb={0}>Projection Horizon</FormLabel>
        <Text fontSize="sm" fontWeight="semibold">{sliderValue} {sliderValue === 1 ? 'month' : 'months'}</Text>
      </HStack>
      <Slider
        id="projection-horizon"
        aria-label="Projection horizon in months"
        value={sliderValue}
        min={1}
        max={36}
        step={1}
        onChange={(v) => handleSliderChange(v)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <SliderMark value={1} mt="1" fontSize="xs">1m</SliderMark>
        <SliderMark value={12} mt="1" fontSize="xs">12m</SliderMark>
        <SliderMark value={24} mt="1" fontSize="xs">24m</SliderMark>
        <SliderMark value={36} mt="1" ml="-6px" fontSize="xs">36m</SliderMark>
        <SliderTrack>
          <SliderFilledTrack />
        </SliderTrack>
        <Tooltip
          hasArrow
          bg="blue.500"
          color="white"
          placement="top"
          isOpen={showTooltip}
          label={`${sliderValue} months`}
        >
          <SliderThumb />
        </Tooltip>
      </Slider>
    </FormControl>
  );
};

export default ProjectionHorizonSelector;
