// One-off inspection script: list public tables and row counts.
// Uses the service-role key (bypasses RLS) so we see everything.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Minimal .env loader (dotenv not installed).
const env = {};
try {
  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch {}

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const tables = [
  'profiles', 'institutions', 'programs', 'interns', 'supervisors',
  'attendance', 'journals', 'documents', 'evaluations', 'audit_logs',
  'notifications', 'tasks', 'courses', 'roles', 'permissions',
];

for (const t of tables) {
  try {
    const { count, error } = await supabase
      .from(t)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`${t.padEnd(16)} ERROR: ${error.message}`);
    } else {
      console.log(`${t.padEnd(16)} ${count}`);
    }
  } catch (e) {
    console.log(`${t.padEnd(16)} THREW: ${e.message}`);
  }
}
