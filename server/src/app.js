import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAuthGuard } from './auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createLibraryRouter } from './routes/library.js';
import { createPlaylistsRouter } from './routes/playlists.js';
import { createTracksRouter } from './routes/tracks.js';
import { HttpError } from './util.js';

export function createApp({ config, db }) {
  const app = express();
  app.disable('x-powered-by');
  // Resolve req.ip from X-Forwarded-For only when a proxy hop is configured,
  // so the login throttle keys on the real client IP behind Dokploy's proxy
  // and cannot be spoofed when the API is exposed directly.
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '1mb' }));

  // Public API routes.
  app.get('/api/health', (req, res) => res.status(200).json({ ok: true }));
  const auth = createAuthRouter({ config });
  app.use('/api/auth', auth.publicRouter);

  // Everything else under /api requires a valid session cookie.
  app.use('/api', createAuthGuard(config));
  app.use('/api/auth', auth.privateRouter);
  app.use('/api', createTracksRouter({ config, db }));
  app.use('/api/library', createLibraryRouter({ config, db }));
  app.use('/api', createPlaylistsRouter({ db }));

  // Unknown /api routes must answer JSON, not fall through to the SPA.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built SPA when present (missing dir is fine in dev).
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  // Uniform JSON error handling for anything thrown above.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (res.headersSent) return next(err);
    const status =
      err instanceof HttpError
        ? err.status
        : Number.isInteger(err.status)
          ? err.status
          : 500;
    const message = status < 500 ? err.message : 'Internal Server Error';
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });

  return app;
}
