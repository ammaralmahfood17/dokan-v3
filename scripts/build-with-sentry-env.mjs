// Build wrapper: make the Sentry release-upload vars visible to `next build`.
//
// WHY THIS EXISTS (2026-09-26)
// withSentryConfig() uploads source maps from a CHILD process (sentry-cli) that
// `next build` spawns. Next loads .env.local for the APPLICATION, but that does
// not put SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN into the environment
// of the build process's children. Locally the upload therefore silently did
// nothing: the build "succeeded", and 467 .map files were still sitting in
// .next afterwards (deleteSourcemapsAfterUpload: true means they only vanish on
// a SUCCESSFUL upload).
//
// On Vercel the env vars are real process environment variables, so production
// was never affected — this is a local-dev/CI-only gap. But it is exactly the
// kind of gap that hides until the one deploy you cannot reproduce, so we close
// it here instead of documenting it.
//
// It reads .env.local WITHOUT a dependency (no dotenv in the tree), honours
// existing environment variables (CI/Vercel must win — never let a stale local
// file override a real secret), and is a no-op when the vars are absent, so it
// costs nothing on a machine that has no Sentry project.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NEEDED = ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN'];
const envFile = resolve(process.cwd(), '.env.local');

if (existsSync(envFile)) {
  for (const rawLine of readFileSync(envFile, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!NEEDED.includes(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // An already-exported value (CI, Vercel) must NOT be overwritten.
    if (process.env[key]) continue;
    if (!value) continue;
    process.env[key] = value;
  }
}

const have = NEEDED.filter((k) => process.env[k]);
if (have.length === NEEDED.length) {
  console.log(`[build] sentry upload env ready (${have.length}/${NEEDED.length} vars)`);
} else {
  // Not an error: a contributor without Sentry credentials must still build.
  console.log(
    `[build] sentry source-map upload will be skipped (missing: ${NEEDED.filter((k) => !process.env[k]).join(', ')})`,
  );
}

const result = spawnSync('npx', ['next', 'build'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
