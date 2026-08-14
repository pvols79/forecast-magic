import { useState } from 'react';
import { Button, ButtonGroup, HStack, Input, Text as ChakraText } from '@chakra-ui/react';
import { FaLock, FaSignOutAlt } from 'react-icons/fa';

const ViewModeControl = ({ authStatus, isAdminView, onAdminView, onHouseholdView, onLogin, onLogout }) => {
  const [password, setPassword] = useState('');

  if (!authStatus) return null;

  if (!authStatus.isAdmin) {
    return (
      <HStack>
        <ChakraText fontSize="sm">Household</ChakraText>
        <Input
          aria-label="Admin password"
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          size="sm"
          maxW="180px"
        />
        <Button size="sm" leftIcon={<FaLock />} onClick={() => onLogin(password)}>Admin</Button>
      </HStack>
    );
  }

  return (
    <HStack>
      <ButtonGroup isAttached size="sm" variant="outline">
        <Button isActive={!isAdminView} onClick={onHouseholdView}>Household</Button>
        <Button isActive={isAdminView} onClick={onAdminView}>Admin</Button>
      </ButtonGroup>
      {authStatus.adminPasswordRequired && (
        <Button size="sm" variant="ghost" aria-label="Sign out Admin" onClick={onLogout} leftIcon={<FaSignOutAlt />}>
          Sign out
        </Button>
      )}
    </HStack>
  );
};

export default ViewModeControl;
