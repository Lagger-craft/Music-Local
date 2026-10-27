import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse TRUST_PROXY into an express `trust proxy` setting (false|true|number). */
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const hops = Number.parseInt(raw, 10);
  if (Number.isInteger(hops) && hops >= 0) return hops > 0 ? hops : false;
  return false;
}

/**
 * Build the runtime configuration from environment variables.
 * - DATA_DIR  storage root (default ./data, resolved against server/ so the
 *             default is stable regardless of the process cwd)
 * - PORT      HTTP port (default 3000)
 * - MUSIC_AUTH_USER / MUSIC_AUTH_PASSWORD  login credentials; when the
 *             password is unset a random one is generated for this boot.
 * - TRUST_PROXY  trusted reverse-proxy hops for req.ip (unset/0 -> false,
 *             "true" -> true, N -> N hops) so the login throttle keys on the
 *             real client IP behind a proxy and cannot be spoofed otherwise.
 */
export function loadConfig(env = process.env) {
  const dataDirRaw = env.DATA_DIR ?? './data';
  const authPassword =
    env.MUSIC_AUTH_PASSWORD ?? crypto.randomBytes(24).toString('base64url');
  return {
    dataDir: path.isAbsolute(dataDirRaw)
      ? dataDirRaw
      : path.resolve(SERVER_ROOT, dataDirRaw),
    port: Number.parseInt(env.PORT ?? '3000', 10) || 3000,
    authUser: env.MUSIC_AUTH_USER ?? 'admin',
    authPassword,
    passwordGenerated: env.MUSIC_AUTH_PASSWORD === undefined,
    jwtSecret: env.MUSIC_AUTH_SECRET ?? crypto.randomBytes(32).toString('base64url'),
    sessionDays: 30,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    webDist: env.WEB_DIST
      ? path.resolve(env.WEB_DIST)
      : path.resolve(SERVER_ROOT, '..', 'web', 'dist'),
  };
}
