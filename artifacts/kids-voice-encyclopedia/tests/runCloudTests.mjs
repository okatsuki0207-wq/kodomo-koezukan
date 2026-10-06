import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A fixed demo project and loopback config, never the app's real Firebase config.
// Do not pass credentials or cloud endpoint overrides to the CLI/test subprocess.
const env = Object.fromEntries(
  ['PATH', 'HOME', 'JAVA_HOME', 'TMPDIR', 'LANG', 'XDG_CACHE_HOME', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
);
env.CI = 'true';
env.FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true';
const result = spawnSync('pnpm', [
  'exec', 'firebase', 'emulators:exec',
  '--project', 'demo-keepsakes-test', '--config', 'firebase/emulator.json',
  '--only', 'firestore,storage', 'node --test --test-concurrency=1 tests/keepsakeLifecycle.test.mjs',
], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
