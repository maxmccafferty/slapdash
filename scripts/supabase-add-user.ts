/**
 * Adds the owner's account to a Slapdash Supabase project (sign-up is off, ADR-0002 §F2):
 *
 *   pnpm supabase:add-user you@example.com
 *
 * Reads SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY (or the legacy
 * SUPABASE_SERVICE_ROLE_KEY) from the environment or the repo-root `.env`, asks for the
 * password without echoing it, and creates a confirmed user through the Auth admin API.
 * Run it on your own machine: the secret key never goes to Vercel or the browser.
 */
import { existsSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean);
const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL')?.replace(/\/+$/, '');
const secret = env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const email = process.argv[2]?.trim();

if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) fail('Usage: pnpm supabase:add-user you@example.com');
if (!url) fail('Set SUPABASE_URL (or VITE_SUPABASE_URL) in .env or the environment.');
if (!secret) fail('Set SUPABASE_SECRET_KEY in .env or the environment (Dashboard → Project Settings → API Keys → Secret keys).');

/** Reads a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(question);
    if (!stdin.isTTY) {
      // Piped input (scripts, CI): read one line.
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => (data += chunk));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''));
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key: string) => {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await askHidden(`Password for ${email}: `);
if (password.length < 8) fail('Use a password of at least 8 characters.');
if (stdin.isTTY) {
  const again = await askHidden('Same password again: ');
  if (again !== password) fail("The passwords don't match.");
}

// New secret keys (sb_secret_…) go in `apikey` only; a legacy service-role JWT also as the bearer.
const headers: Record<string, string> = { apikey: secret, 'Content-Type': 'application/json' };
if (secret.startsWith('eyJ')) headers.Authorization = `Bearer ${secret}`;

const res = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password, email_confirm: true }),
}).catch((e: unknown) => fail(`Couldn't reach ${url}: ${e instanceof Error ? e.message : String(e)}. Is the project paused?`));

const body = (await res.json().catch(() => ({}))) as { id?: string; msg?: string; message?: string; error_code?: string };
if (!res.ok) {
  if (body.error_code === 'email_exists') fail(`${email} already has an account. Change its password in the Dashboard → Authentication → Users.`);
  fail(`Supabase refused (HTTP ${res.status}): ${body.msg ?? body.message ?? 'no details'}.`);
}
console.log(`Added ${email} (user ${body.id}). Sign in on each device; add a passkey when the app offers one.`);
