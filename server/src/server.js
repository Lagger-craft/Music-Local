import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();

if (config.passwordGenerated) {
  const line = '='.repeat(72);
  console.warn(`\n${line}`);
  console.warn('  MUSIC_AUTH_PASSWORD is not set — generated a RANDOM password for this boot.');
  console.warn(`  Login user:     ${config.authUser}`);
  console.warn(`  Login password: ${config.authPassword}`);
  console.warn('  Set MUSIC_AUTH_PASSWORD in the environment to choose your own.');
  console.warn(`${line}\n`);
}

const db = openDatabase(config.dataDir);
const app = createApp({ config, db });

app.listen(config.port, () => {
  console.log(`retro-deck API listening on port ${config.port} (DATA_DIR=${config.dataDir})`);
});
