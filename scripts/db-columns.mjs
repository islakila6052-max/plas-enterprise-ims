import { readFileSync } from 'node:fs';
import pg from 'pg';

let url = process.env.SUPABASE_DB_URL
  || readFileSync(new URL('../supabase/.temp/pooler-url', import.meta.url), 'utf8').trim();
const hasPw = /:\/\/[^/@]+:[^/@]*@/.test(url);
if (process.env.DB_PASSWORD && !hasPw) {
  url = url.replace(/@([^@]*)$/, `:${encodeURIComponent(process.env.DB_PASSWORD)}@$1`);
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const tables = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['profiles', 'announcements', 'announcement_likes', 'notifications', 'audit_logs', 'institutions', 'programs', 'departments', 'supervisors', 'interns'];

for (const t of tables) {
  const { rows } = await c.query(
    `select column_name, data_type, is_nullable, column_default, is_generated
       from information_schema.columns where table_schema='public' and table_name=$1
      order by ordinal_position`, [t]);
  console.log(`\n### ${t}  (${rows.length} cols)`);
  for (const r of rows) {
    console.log(`  ${r.column_name.padEnd(24)} ${r.data_type.padEnd(16)} ${r.is_generated === 'ALWAYS' ? 'GENERATED' : ''} ${r.column_default ?? ''}`);
  }
}

console.log('\n### FK integrity / orphans');
const q = [
  ['interns with no supervisor link', `select count(*)::int n from public.interns i where i.supervisor_id is null`],
  ['supervisors rows', `select count(*)::int n from public.supervisors`],
  ['interns pointing at missing supervisor', `select count(*)::int n from public.interns i where i.supervisor_id is not null and not exists (select 1 from public.supervisors s where s.id=i.supervisor_id)`],
  ['interns with missing profile', `select count(*)::int n from public.interns i where i.profile_id is not null and not exists (select 1 from public.profiles p where p.id=i.profile_id)`],
  ['interns pointing at missing institution', `select count(*)::int n from public.interns i where i.institution_id is not null and not exists (select 1 from public.institutions x where x.institution_id=i.institution_id)`],
  ['interns pointing at missing program', `select count(*)::int n from public.interns i where i.program_id is not null and not exists (select 1 from public.programs x where x.program_id=i.program_id)`],
  ['profiles by role', `select role::text role, count(*)::int n from public.profiles group by 1 order by 1`],
  ['attendance orphan intern', `select count(*)::int n from public.attendance a where not exists (select 1 from public.interns i where i.id=a.intern_id)`],
];
for (const [label, sql] of q) {
  try { const { rows } = await c.query(sql); console.log(`  ${String(rows[0].n).padStart(5)}  ${label}`); }
  catch (e) { console.log(`  ERR   ${label}: ${e.message}`); }
}

await c.end();
