import { Router } from 'express';
import { config } from '../config.js';
import { login, logout } from '../auth.js';

export const createAuthRouter = () => {
  const router = Router();
  router.get('/status', (request, response) => response.json({
    isAdmin: request.isAdmin,
    adminPasswordRequired: Boolean(config.adminPassword),
  }));
  router.post('/login', login);
  router.delete('/logout', logout);
  return router;
};
