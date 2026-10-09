import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
try {
  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch {}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log('=== profiles ===');
const { data: p, error: pe } = await supabase.from('profiles').select('*');
console.log(pe ? pe : JSON.stringify(p, null, 2));

console.log('=== interns ===');
const { data: i, error: ie } = await supabase.from('interns').select('*');
console.log(ie ? ie : JSON.stringify(i, null, 2));

for (const t of ['journals', 'tasks', 'courses', 'roles', 'permissions']) {
  const { data, error } = await supabase.from(t).select('*').limit(1);
  console.log(`--- ${t} ---`, error ? `ERROR: ${error.message}` : `OK rows=${data.length}`);
}
