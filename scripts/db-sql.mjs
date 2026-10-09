#!/usr/bin/env node
// Run ad-hoc SQL against the live database and print the rows.
//   node scripts/db-sql.mjs "select * from public.settings"
//   node scripts/db-sql.mjs path/to/file.sql
// Reads the pooler URL from supabase/.temp/pooler-url (or SUPABASE_DB_URL)
// and injects DB_PASSWORD, exactly like `supabase db push` does.
import { readFileSync } from 'node:fs';
import pg from 'pg';

let url = process.env.SUPABASE_DB_URL
  || readFileSync(new URL('../supabase/.temp/pooler-url', import.meta.url), 'utf8').trim();
if (process.env.DB_PASSWORD && !/:\/\/[^/@]+:[^/@]*@/.test(url)) {
  url = url.replace(/@([^@]*)$/, `:${encodeURIComponent(process.env.DB_PASSWORD)}@$1`);
}

const arg = process.argv.slice(2).join(' ').trim();
if (!arg) { console.error('usage: node scripts/db-sql.mjs "<sql>" | <file.sql>'); process.exit(2); }
const sql = /\.(sql)$/i.test(arg) || arg.includes('/') || arg.includes('\\')
  ? readFileSync(arg, 'utf8')
  : arg;

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const res = await c.query(sql);
  if (res.command === 'SELECT' || res.rows?.length) {
    console.table(res.rows);
    console.log(`(${res.rowCount} row${res.rowCount === 1 ? '' : 's'})`);
  } else {
    console.log(`${res.command} OK${res.rowCount != null ? ` (${res.rowCount})` : ''}`);
  }
} catch (e) {
  console.error(`ERROR ${e.code ?? ''} ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
