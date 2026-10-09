import { readFileSync } from 'node:fs';
import pg from 'pg';

// ---- read pooler URL from CLI temp file (same one `supabase db push` uses) ----
let url = process.env.SUPABASE_DB_URL
  || readFileSync(new URL('../supabase/.temp/pooler-url', import.meta.url), 'utf8').trim();
const hasPw = /:\/\/[^/@]+:[^/@]*@/.test(url);
if (process.env.DB_PASSWORD && !hasPw) {
  // insert password after the username (before the last @)
  url = url.replace(/@([^@]*)$/, `:${encodeURIComponent(process.env.DB_PASSWORD)}@$1`);
}

const NEEDS = {
  tables: [
    'profiles', 'interns', 'supervisors', 'departments', 'institutions', 'programs',
    'attendance', 'daily_journals', 'documents', 'evaluations', 'announcements',
    'announcement_likes', 'notifications', 'audit_logs', 'settings',
  ],
  columns: {
    profiles: ['id', 'role', 'full_name', 'email', 'avatar_url', 'contact_number', 'bio'],
    interns: ['id', 'profile_id', 'first_name', 'last_name', 'full_name', 'email', 'supervisor_id', 'department_id', 'institution_id', 'program_id', 'required_hours', 'start_date', 'end_date'],
    supervisors: ['id', 'profile_id', 'first_name', 'last_name', 'full_name', 'email', 'department_id'],
    attendance: ['id', 'intern_id', 'date', 'time_in', 'time_out', 'total_hours', 'method', 'remarks', 'claim_status'],
    daily_journals: ['id', 'intern_id', 'supervisor_id', 'date', 'activities', 'hours_worked', 'supervisor_comment'],
    documents: ['id', 'intern_id', 'type', 'label', 'file_path', 'file_name', 'file_size', 'mime_type', 'reviewed_by'],
    evaluations: ['id', 'intern_id', 'supervisor_id', 'attendance', 'communication', 'teamwork', 'initiative', 'technical_skills', 'professionalism', 'overall_rating', 'comments'],
    announcements: ['id', 'title', 'body', 'category', 'pinned', 'published_by'],
    announcement_likes: ['announcement_id', 'user_id'],
    notifications: ['id', 'user_id', 'type', 'title', 'message', 'link', 'metadata', 'is_read'],
    audit_logs: ['id', 'action', 'resource_type', 'resource_id', 'changes'],
    settings: ['id'],
    departments: ['id', 'name'],
    institutions: ['institution_id', 'institution_name'],
    programs: ['program_id', 'program_name'],
  },
  rpcs: {
    attendance_clock_in: ['text'],
    attendance_clock_out: ['timestamptz', 'text'],
    attendance_submit_claim: ['uuid', 'timestamptz', 'text'],
    attendance_review_claim: ['uuid', 'text', 'text'],
    journal_review: ['uuid', 'text', 'text'],
    document_review: ['uuid', 'text'],
    evaluation_create: ['uuid', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer', 'text', 'text'],
    update_own_profile: ['text', 'text', 'text', 'text'],
    notify_user: ['uuid', 'text', 'text', 'text', 'text', 'jsonb'],
    write_audit_log: ['text', 'text', 'uuid', 'jsonb'],
    announcement_create: ['text', 'text', 'text', 'boolean'],
    announcement_update: ['uuid', 'text', 'text', 'text', 'boolean'],
    announcement_delete: ['uuid'],
    intern_profile_id: [],
    profile_ids_by_role: [],
  },
};

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? '  OK  ' : 'MISS  '} ${msg}`); };

console.log('== TABLES ==');
const tabs = new Set((await c.query(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)).rows.map(r => r.table_name));
for (const t of NEEDS.tables) say(tabs.has(t), `table ${t}`);

console.log('\n== COLUMNS ==');
for (const [t, cols] of Object.entries(NEEDS.columns)) {
  if (!tabs.has(t)) continue;
  const have = new Set((await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [t])).rows.map(r => r.column_name));
  for (const col of cols) say(have.has(col), `${t}.${col}`);
}

console.log('\n== RPCs ==');
const fns = (await c.query(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.map(r => r.sig);
const fnSet = new Set(fns);
for (const [name, args] of Object.entries(NEEDS.rpcs)) {
  const want = `${name}(${args.join(', ')})`;
  say(fnSet.has(want) || fns.some(s => s.startsWith(`${name}(`)), `fn ${name}`);
}

console.log('\n== ROW COUNTS ==');
for (const t of [...NEEDS.tables]) {
  if (!tabs.has(t)) { console.log(`  ----  ${t} (missing)`); continue; }
  const { rows } = await c.query(`select count(*)::int as n from public.${t}`);
  console.log(`  ${String(rows[0].n).padStart(6)}  ${t}`);
}

console.log(`\n${bad === 0 ? 'ALL CHECKS PASSED' : `${bad} MISSING ITEMS`}`);
await c.end();
