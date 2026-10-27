import { Router } from 'express';
import {
  credentialsMatch,
  createAuthGuard,
  LoginThrottle,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from '../auth.js';
import { httpError } from '../util.js';

/**
 * Auth routes are split so only POST /api/auth/login is public; /me and
 * /logout are mounted behind the auth guard by the app.
 */
export function createAuthRouter({ config, throttle = new LoginThrottle() }) {
  const publicRouter = Router();

  publicRouter.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    const ip = req.ip ?? 'unknown';
    if (throttle.isBlocked(ip)) {
      throw httpError(429, 'Too many login attempts, try again later.');
    }
    const userOk =
      typeof username === 'string' &&
      credentialsMatch(username, config.authUser);
    const passOk =
      typeof password === 'string' &&
      credentialsMatch(password, config.authPassword);
    if (!userOk || !passOk) {
      throttle.recordFailure(ip);
      throw httpError(401, 'Invalid credentials');
    }
    throttle.clear(ip);
    const token = await signSession(config, config.authUser);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config));
    res.status(200).json({ user: { username: config.authUser } });
  });

  const privateRouter = Router();
  privateRouter.use(createAuthGuard(config));

  privateRouter.get('/me', (req, res) => {
    res.status(200).json({ user: req.user });
  });

  privateRouter.post('/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(config), maxAge: undefined });
    res.status(204).end();
  });

  return { publicRouter, privateRouter };
}
