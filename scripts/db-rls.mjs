import { readFileSync } from 'node:fs';
import pg from 'pg';

let url = process.env.SUPABASE_DB_URL
  || readFileSync(new URL('../supabase/.temp/pooler-url', import.meta.url), 'utf8').trim();
if (process.env.DB_PASSWORD && !/:\/\/[^/@]+:[^/@]*@/.test(url)) {
  url = url.replace(/@([^@]*)$/, `:${encodeURIComponent(process.env.DB_PASSWORD)}@$1`);
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const TABLES = ['profiles', 'interns', 'supervisors', 'departments', 'institutions', 'programs',
  'attendance', 'daily_journals', 'documents', 'evaluations', 'announcements',
  'announcement_likes', 'notifications', 'audit_logs', 'settings'];

console.log('== RLS ENABLED ==');
const rl = (await c.query(`select relname, relrowsecurity, relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' order by 1`)).rows;
for (const t of TABLES) {
  const r = rl.find(x => x.relname === t);
  if (!r) { console.log(`  MISS  ${t} (table absent)`); continue; }
  console.log(`  ${r.relrowsecurity ? 'ON ' : 'OFF'}  ${t}${r.relforcerowsecurity ? '  (FORCE)' : ''}`);
}

console.log('\n== POLICIES per table ==');
const pol = (await c.query(`select tablename, policyname, cmd, qual is not null as has_using,
  with_check is not null as has_check
  from pg_policies where schemaname='public' order by tablename, policyname`)).rows;
for (const t of TABLES) {
  const list = pol.filter(p => p.tablename === t);
  console.log(`  ${t}: ${list.length ? list.map(p => `${p.policyname}[${p.cmd}]`).join(', ') : '*** NO POLICIES ***'}`);
}

console.log('\n== TABLE GRANTS for authenticated ==');
const gr = (await c.query(`select table_name, string_agg(privilege_type, ',') p
  from information_schema.role_table_grants
  where grantee='authenticated' and table_schema='public' group by 1 order by 1`)).rows;
for (const t of TABLES) {
  const g = gr.find(x => x.table_name === t);
  console.log(`  ${g ? g.p.padEnd(30) : '*** NO GRANTS ***'} ${t}`);
}

console.log('\n== STORAGE BUCKETS ==');
try {
  const b = (await c.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`)).rows;
  for (const x of b) console.log(`  ${x.id.padEnd(24)} public=${x.public} limit=${x.file_size_limit}`);
} catch (e) { console.log('  ERR ' + e.message); }
try {
  const p = (await c.query(`select tablename, policyname from pg_policies where schemaname='storage' and tablename='objects' order by policyname`)).rows;
  console.log('  storage.objects policies: ' + (p.map(x => x.policyname).join(', ') || 'NONE'));
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== PROFILE ROLES ==');
for (const r of (await c.query(`select role::text r, count(*)::int n from public.profiles group by 1 order by 1`)).rows)
  console.log(`  ${r.n}  ${r.r}`);

console.log('\n== SAMPLE interns ==');
for (const r of (await c.query(`select first_name, last_name, email, student_number, school, course, supervisor_id is null as no_sup from public.interns order by created_at limit 10`)).rows)
  console.log(`  ${JSON.stringify(r)}`);

console.log('\n== SAMPLE profiles ==');
for (const r of (await c.query(`select full_name, email, role::text, intern_id, supervisor_id from public.profiles order by created_at limit 10`)).rows)
  console.log(`  ${JSON.stringify(r)}`);

console.log('\n== user_role enum ==');
try {
  for (const r of (await c.query(`select e.enumlabel v from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='user_role' order by e.enumsortorder`)).rows)
    console.log('  ' + r.v);
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== auth.users ==');
try {
  for (const r of (await c.query(`select u.email, u.created_at::date d,
    (select raw_user_meta_data->>'role' from auth.users x where x.id=u.id) meta
    from auth.users u order by u.created_at`)).rows)
    console.log('  ' + JSON.stringify(r));
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== is_admin() / helpers ==');
for (const f of (await c.query(`select p.oid::regprocedure::text s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_admin','is_supervisor','current_intern_id','current_supervisor_id','handle_new_user','set_role_from_email') order by 1`)).rows)
  console.log('  ' + f.s);

console.log('\n== triggers on profiles/interns ==');
for (const r of (await c.query(`
  select c.relname tbl, t.tgname, p.oid::regprocedure::text fn
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not t.tgisinternal
   order by 1,2`)).rows)
  console.log(`  ${r.tbl.padEnd(14)} ${r.tgname.padEnd(28)} -> ${r.fn}`);

console.log('\n== existing interns rows referenced by child tables ==');
for (const [label, sql] of [
  ['attendance', `select count(*)::int n from public.attendance a join public.interns i on i.id=a.intern_id where i.email in ('supervisor@supervisor.com','admin@admin.com','admi@admin.com','ytftfcyt@g.gy')`],
  ['daily_journals', `select count(*)::int n from public.daily_journals a join public.interns i on i.id=a.intern_id where i.email in ('supervisor@supervisor.com','admin@admin.com','admi@admin.com','ytftfcyt@g.gy')`],
  ['documents', `select count(*)::int n from public.documents a join public.interns i on i.id=a.intern_id where i.email in ('supervisor@supervisor.com','admin@admin.com','admi@admin.com','ytftfcyt@g.gy')`],
  ['evaluations', `select count(*)::int n from public.evaluations a join public.interns i on i.id=a.intern_id where i.email in ('supervisor@supervisor.com','admin@admin.com','admi@admin.com','ytftfcyt@g.gy')`],
]) {
  try { const { rows } = await c.query(sql); console.log(`  ${rows[0].n}  ${label}`); }
  catch (e) { console.log(`  ERR ${label}: ${e.message}`); }
}

console.log('\n== audit_logs rows ==');
try {
  for (const r of (await c.query(`select u.email, a.action, a.resource_type, a.changes, a.created_at from public.audit_logs a left join public.profiles p on p.id=a.user_id left join auth.users u on u.id=p.id order by a.created_at desc limit 10`)).rows)
    console.log('  ' + JSON.stringify(r));
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== profiles timestamps ==');
try {
  for (const r of (await c.query(`select email, role::text, created_at::timestamp(0) c, updated_at::timestamp(0) u from public.profiles order by updated_at desc`)).rows)
    console.log('  ' + JSON.stringify(r));
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== which interns own child rows ==');
const OWNER = `select i.id, i.email, i.first_name, i.last_name from public.interns i`;
for (const [label, sql] of [
  ['attendance', `select i.email, count(*)::int n from public.attendance a join public.interns i on i.id=a.intern_id group by 1`],
  ['daily_journals', `select i.email, count(*)::int n from public.daily_journals a join public.interns i on i.id=a.intern_id group by 1`],
  ['documents', `select i.email, count(*)::int n from public.documents a join public.interns i on i.id=a.intern_id group by 1`],
]) {
  try { for (const r of (await c.query(sql)).rows) console.log(`  ${label.padEnd(15)} ${r.n}  ${r.email}`); }
  catch (e) { console.log(`  ERR ${label}: ${e.message}`); }
}

console.log('\n== handle_new_user + ensure_role_rows source ==');
for (const fn of ['handle_new_user', 'ensure_role_rows', 'sync_profile_links', 'is_admin', 'current_supervisor_id', 'guard_profile_columns']) {
  try {
    const { rows } = await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 limit 1`, [fn]);
    console.log(`\n----- ${fn} -----\n${rows[0]?.d ?? 'NOT FOUND'}`);
  } catch (e) { console.log(`  ERR ${fn}: ${e.message}`); }
}

console.log('\n== child row owners ==');
for (const [label, sql] of [
  ['attendance', `select i.email, count(*)::int n from public.attendance a join public.interns i on i.id=a.intern_id group by 1`],
  ['daily_journals', `select i.email, count(*)::int n from public.daily_journals a join public.interns i on i.id=a.intern_id group by 1`],
  ['documents', `select i.email, count(*)::int n from public.documents a join public.interns i on i.id=a.intern_id group by 1`],
]) {
  try { for (const r of (await c.query(sql)).rows) console.log(`  ${label.padEnd(15)} ${r.n}  ${r.email}`); }
  catch (e) { console.log(`  ERR ${label}: ${e.message}`); }
}

console.log('\n----- handle_new_user -----');
try {
  const { rows } = await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='handle_new_user' limit 1`);
  console.log(rows[0]?.d ?? 'NOT FOUND');
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n----- audit_profile_changes -----');
try {
  const { rows } = await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='audit_profile_changes' limit 1`);
  console.log(rows[0]?.d ?? 'NOT FOUND');
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== nullability of audit_logs.user_id ==');
for (const r of (await c.query(`select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='audit_logs' and column_name in ('user_id','action','resource_type')`)).rows)
  console.log('  ' + JSON.stringify(r));

console.log('\n== phantom intern rows for non-intern profiles ==');
for (const r of (await c.query(`
  select i.email, p.role::text as profile_role,
    ((select count(*) from public.attendance a where a.intern_id=i.id)
   + (select count(*) from public.daily_journals j where j.intern_id=i.id)
   + (select count(*) from public.documents d where d.intern_id=i.id)
   + (select count(*) from public.evaluations e where e.intern_id=i.id)) as child_rows
  from public.interns i join public.profiles p on p.id=i.profile_id
  where p.role <> 'intern' order by 1`)).rows)
  console.log('  ' + JSON.stringify(r));

console.log('\n== FKs where profiles is the referencing table ==');
for (const r of (await c.query(`
  select kcu.column_name, pcu.table_name as ref_table, rc.delete_rule
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu
      on kcu.constraint_schema=rc.constraint_schema and kcu.constraint_name=rc.constraint_name
    join information_schema.constraint_column_usage pcu
      on pcu.constraint_schema=rc.constraint_schema and pcu.constraint_name=rc.constraint_name
   where rc.constraint_schema='public' and kcu.table_name='profiles'
   order by 1`)).rows)
  console.log('  ' + JSON.stringify(r));

console.log('\n== phantom interns by known non-intern emails (child counts) ==');
for (const r of (await c.query(`
  select i.id, i.email, p.role::text as role_now,
    ((select count(*) from public.attendance a where a.intern_id=i.id)
   + (select count(*) from public.daily_journals j where j.intern_id=i.id)
   + (select count(*) from public.documents d where d.intern_id=i.id)
   + (select count(*) from public.evaluations e where e.intern_id=i.id)) as child_rows,
    (p.intern_id = i.id) as profile_points_here
  from public.interns i join public.profiles p on p.id=i.profile_id
  where i.email in ('admin@admin.com','admi@admin.com','supervisor@supervisor.com','ytftfcyt@g.gy')
  order by i.email`)).rows)
  console.log('  ' + JSON.stringify(r));

console.log('\n== EXECUTE grants on public functions ==');
for (const r of (await c.query(`
  select p.oid::regprocedure::text sig, p.proacl is null as default_acl,
    coalesce(string_agg(distinct g.rolname, ','), 'NONE') grantees
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    left join lateral aclexplode(p.proacl) a on true
    left join pg_roles g on g.oid = a.grantee and a.grantee <> 0
   where n.nspname='public' and p.prokind='f'
     and p.proname in ('attendance_clock_in','attendance_clock_out','attendance_submit_claim',
       'attendance_review_claim','journal_review','document_review','evaluation_create',
       'update_own_profile','notify_user','notify_role','write_audit_log',
       'announcement_create','announcement_update','announcement_delete',
       'intern_profile_id','profile_ids_by_role')
   group by 1, 2 order by 1`)).rows)
  console.log(`  ${(r.default_acl ? 'DEFAULT(PUBLIC)' : r.grantees).padEnd(30)} ${r.sig}`);

console.log('\n== FK where profiles is REFERENCED ==');
for (const r of (await c.query(`
  select kcu.column_name, kcu.table_name as ref_by, rc.delete_rule
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu
      on kcu.constraint_schema=rc.constraint_schema and kcu.constraint_name=rc.constraint_name
    join information_schema.constraint_column_usage pcu
      on pcu.constraint_schema=rc.constraint_schema and pcu.constraint_name=rc.constraint_name
   where rc.constraint_schema in ('public','auth')
     and pcu.table_name='profiles'
   order by 1`)).rows)
  console.log('  ' + JSON.stringify(r));

console.log('\n== status enums ==');
for (const t of ['journal_status', 'document_status', 'evaluation_status', 'attendance_status']) {
  try {
    const { rows } = await c.query(`select e.enumlabel v from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname=$1 order by e.enumsortorder`, [t]);
    console.log(`  ${t}: ${rows.map(r => r.v).join(', ')}`);
  } catch (e) { console.log(`  ERR ${t}: ${e.message}`); }
}

console.log('\n== journal_review / document_review / evaluation_create source ==');
for (const fn of ['journal_review', 'document_review', 'attendance_clock_in']) {
  try {
    const { rows } = await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 limit 1`, [fn]);
    console.log(`\n----- ${fn} -----\n${rows[0]?.d ?? 'NOT FOUND'}`);
  } catch (e) { console.log(`  ERR ${fn}: ${e.message}`); }
}

console.log('\n== policy quals (public) ==');
for (const r of (await c.query(`
  select tablename, policyname, cmd, roles::text as to_roles,
         coalesce(qual, '-') as using_clause
    from pg_policies where schemaname='public'
   order by tablename, policyname`)).rows)
  console.log(`\n  [${r.tablename}] ${r.policyname} (${r.cmd} to ${r.to_roles})\n     USING: ${r.using_clause}`);

console.log('\n== RLS helper functions referenced by policies ==');
for (const fn of ['current_supervisor_intern_ids', 'can_delete_users', 'current_intern_id', 'current_supervisor_id', 'is_admin', 'is_supervisor']) {
  const { rows } = await c.query(
    `select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname=$1) as ok`, [fn]);
  console.log(`  ${rows[0].ok ? 'OK  ' : 'MISS'}  ${fn}`);
}

console.log('\n== dangling refs to is_supervisor ==');
try {
  const { rows } = await c.query(`
    select 'policy' as kind, tablename::text as obj, policyname::text as name
      from pg_policies
     where schemaname='public'
       and (coalesce(qual::text,'') || coalesce(with_check::text,'')) like '%is_supervisor%'
    union all
    select 'function' as kind, p.proname::text as obj, 'body'::text as name
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and pg_get_functiondef(p.oid) like '%is_supervisor%'`);
  console.log(rows.length ? rows.map(r => `  ${r.kind} ${r.obj}.${r.name}`).join('\n') : '  none (is_supervisor is unused - safe)');
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== clock skew: local vs db ==');
for (const r of (await c.query(`select now() as db_now, current_setting('TimeZone') tz`)).rows)
  console.log(`  DB   ${r.db_now.toISOString()}  (tz ${r.tz})`);
console.log(`  LOCAL ${new Date().toISOString()}`);

console.log('\n== document_review / attendance_clock_out source ==');
for (const fn of ['document_review', 'attendance_clock_out']) {
  try {
    const { rows } = await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 limit 1`, [fn]);
    console.log(`\n----- ${fn} -----\n${rows[0]?.d ?? 'NOT FOUND'}`);
  } catch (e) { console.log(`  ERR ${fn}: ${e.message}`); }
}

console.log('\n== FULL FUNCTION SOURCE DUMP ==');
for (const fn of ['journal_review', 'document_review']) {
  try {
    const { rows } = await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 limit 1`, [fn]);
    console.log(`\n===== ${fn} =====\n${rows[0]?.d ?? 'NOT FOUND'}`);
  } catch (e) { console.log(`  ERR ${fn}: ${e.message}`); }
}

console.log('\n== potential text->enum assignments in functions ==');
const allFns = await c.query(`
  select p.proname::text as fn, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f' order by 1`);
const suspicious = /set\s+(status|role|claim_status)\s*=\s*(p_[a-z_]+|nullif\(|coalesce\()/i;
for (const r of allFns.rows) {
  const hits = r.def.split("\n").filter((l) => suspicious.test(l));
  if (hits.length) console.log(`  ${r.fn}:\n${hits.map((h) => `      ${h.trim()}`).join("\n")}`);
}

console.log('\n== enum-typed columns in public schema ==');
const enumCols = await c.query(`
  select c.relname::text as tbl, a.attname::text as col, t.typname::text as enum
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_type t on t.oid=a.atttypid
   where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
     and t.typtype='e'
   order by 1,2`);
for (const r of enumCols.rows) console.log(`  ${r.tbl}.${r.col} -> ${r.enum}`);

console.log('\n== migration history (applied) ==');
try {
  for (const r of (await c.query(`select version, name from supabase_migrations.schema_migrations order by version desc limit 6`)).rows)
    console.log(`  ${r.version}  ${r.name}`);
  const { rows } = await c.query(`select count(*)::int n from supabase_migrations.schema_migrations`);
  console.log(`  (${rows[0].n} applied in total)`);
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== grants on the two repaired RPCs ==');
for (const r of (await c.query(`
  select p.oid::regprocedure::text sig, p.proacl is null as default_acl,
    coalesce(string_agg(distinct g.rolname, ','), 'NONE') grantees
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    left join lateral aclexplode(p.proacl) a on true
    left join pg_roles g on g.oid = a.grantee and a.grantee <> 0
   where n.nspname='public' and p.proname in ('journal_review','document_review')
   group by 1,2 order by 1`)).rows)
  console.log(`  ${(r.default_acl ? 'DEFAULT(PUBLIC)' : r.grantees).padEnd(34)} ${r.sig}`);

console.log('\n== review RPC bodies use explicit enum casts ==');
for (const r of (await c.query(`
  select p.proname::text fn, pg_get_functiondef(p.oid) ~ 'p_status::public\.[a-z_]+status' as has_cast
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('journal_review','document_review')`)).rows)
  console.log(`  ${r.has_cast ? 'OK  ' : 'MISS'}  ${r.fn}`);

console.log('\n== any ims-verify leftovers anywhere ==');
try {
  const p = await c.query(`select id, email from public.profiles where email like 'ims-verify-%'`);
  console.log(`  profiles: ${p.rows.length ? JSON.stringify(p.rows) : 'none'}`);
  const a = await c.query(`select id, email from auth.users where email like 'ims-verify-%'`);
  console.log(`  auth.users: ${a.rows.length ? JSON.stringify(a.rows) : 'none'}`);
  const n = await c.query(`select n.id, n.title, n.created_at::timestamp(0) t from public.notifications n where n.title like 'Verify%' or n.message = 'temporary'`);
  console.log(`  notifications: ${n.rows.length ? JSON.stringify(n.rows) : 'none'}`);
  const an = await c.query(`select id, title from public.announcements where title like 'Verify announcement%'`);
  console.log(`  announcements: ${an.rows.length ? JSON.stringify(an.rows) : 'none'}`);
  const au = await c.query(`select id, action, resource_type, created_at::timestamp(0) t from public.audit_logs where resource_type = '__verify__'`);
  console.log(`  audit_logs(__verify__): ${au.rows.length ? JSON.stringify(au.rows) : 'none'}`);
} catch (e) { console.log('  ERR ' + e.message); }

console.log('\n== notifications now ==');
try {
  for (const r of (await c.query(`select p.email, n.title, n.is_read, n.created_at::timestamp(0) t from public.notifications n left join public.profiles p on p.id = n.user_id order by n.created_at desc limit 8`)).rows)
    console.log('  ' + JSON.stringify(r));
} catch (e) { console.log('  ERR ' + e.message); }

await c.end();
