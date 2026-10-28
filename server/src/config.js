import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse TRUST_PROXY into an express `trust proxy` setting (false|number).
 *  `true` maps to a single hop: trust-all would let a client pick the
 *  leftmost X-Forwarded-For entry and rotate past the login throttle. */
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return 1;
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
 *             password is unset OR empty/whitespace a random one is generated
 *             for this boot (an empty env value must not disable auth).
 * - MUSIC_AUTH_SECRET  session signing key; unset/blank -> generated once and
 *             persisted at DATA_DIR/session.key (0600) so logins survive
 *             container restarts. Set a stable value to manage it yourself.
 * - MUSIC_COOKIE_SECURE  set to true/1 to mark the session cookie Secure
 *             (use behind TLS ONLY: over plain HTTP the browser refuses to
 *             store a Secure cookie and every reload logs the user out).
 * - TRUST_PROXY  trusted reverse-proxy hops for req.ip (unset/0 -> false,
 *             "true" -> 1 hop, N -> N hops) so the login throttle keys on the
 *             real client IP behind a proxy and cannot be spoofed otherwise.
 */
/**
 * Resolve the session signing secret. `MUSIC_AUTH_SECRET` wins when set to a
 * non-blank value (a blank env value must not become the signing key);
 * otherwise the secret is read from `DATA_DIR/session.key` and, when missing
 * or invalid, generated and persisted there (0600) so logins survive
 * container restarts and redeploys without any configuration. The key file is
 * machine-owned: custom keys go through the env var. An unwritable DATA_DIR
 * falls back to a per-boot random secret — boot must never fail over session
 * storage — and every fallback or repair is warned about without ever
 * printing key material.
 */
const SESSION_KEY_FILE = 'session.key';
/** Shape of a key minted here: 32 random bytes as base64url (43 chars). */
const GENERATED_KEY_RE = /^[A-Za-z0-9_-]{32,}$/;

function resolveJwtSecret(env, dataDir) {
  const fromEnv = env.MUSIC_AUTH_SECRET;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;

  const keyPath = path.join(dataDir, SESSION_KEY_FILE);
  const generated = crypto.randomBytes(32).toString('base64url');
  /** Adopt only well-formed key content; blank/corrupt content must never sign. */
  const adopt = (raw) => {
    const key = String(raw).trim();
    return GENERATED_KEY_RE.test(key) ? key : null;
  };

  let missing = false;
  try {
    const adopted = adopt(fs.readFileSync(keyPath, 'utf8'));
    if (adopted !== null) return adopted;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[auth] cannot read ${keyPath}: falling back to a per-boot session secret`);
      return generated;
    }
    missing = true;
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (missing) {
      // Exclusive create: a concurrent boot must adopt, never overwrite, the key.
      fs.writeFileSync(keyPath, `${generated}\n`, { mode: 0o600, flag: 'wx' });
      return generated;
    }
    // Existing file with blank or corrupt content: repair it in place so the
    // persistence goal does not silently stay unmet forever.
    console.warn(`[auth] invalid content in ${keyPath}: writing a fresh session key`);
    fs.writeFileSync(keyPath, `${generated}\n`, { mode: 0o600 });
    return generated;
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Lost the creation race: adopt the winner's key.
      try {
        const adopted = adopt(fs.readFileSync(keyPath, 'utf8'));
        if (adopted !== null) return adopted;
      } catch {
        // Fall through to the ephemeral secret.
      }
    }
    console.warn(`[auth] cannot write ${keyPath}: falling back to a per-boot session secret`);
    return generated;
  }
}

export function loadConfig(env = process.env) {
  const dataDirRaw = env.DATA_DIR ?? './data';
  const dataDir = path.isAbsolute(dataDirRaw)
    ? dataDirRaw
    : path.resolve(SERVER_ROOT, dataDirRaw);
  const rawPassword = env.MUSIC_AUTH_PASSWORD;
  const passwordSet = typeof rawPassword === 'string' && rawPassword.trim() !== '';
  const authPassword = passwordSet
    ? rawPassword
    : crypto.randomBytes(24).toString('base64url');
  return {
    dataDir,
    port: Number.parseInt(env.PORT ?? '3000', 10) || 3000,
    authUser: env.MUSIC_AUTH_USER ?? 'admin',
    authPassword,
    passwordGenerated: !passwordSet,
    cookieSecure: env.MUSIC_COOKIE_SECURE === 'true' || env.MUSIC_COOKIE_SECURE === '1',
    jwtSecret: resolveJwtSecret(env, dataDir),
    sessionDays: 30,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    webDist: env.WEB_DIST
      ? path.resolve(env.WEB_DIST)
      : path.resolve(SERVER_ROOT, '..', 'web', 'dist'),
  };
}
