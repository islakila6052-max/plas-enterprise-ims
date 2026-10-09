# Attendance Schema Summary

## Database Schema

### Attendance Table Structure
```sql
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.interns (id) on delete cascade,
  date date not null default current_date,
  time_in timestamptz,
  time_out timestamptz,
  total_hours numeric not null default 0,
  method text default 'manual',
  status attendance_status not null default 'present',
  created_at timestamptz not null default now ()
);

-- Indexes
create index if not exists attendance_intern_idx on public.attendance (intern_id);
create index if not exists attendance_date_idx on public.attendance (date);

-- Unique constraint: one attendance record per intern per day
create unique index if not exists attendance_unique_per_day
  on public.attendance (intern_id, date);

-- Columns added for missed clock-out claims:
-- claimed_time_out timestamptz
-- claim_status text check (claim_status in ('pending', 'approved', 'rejected'))
-- claim_remarks text
-- claim_reviewed_by uuid references public.profiles (id) on delete set null
-- claim_reviewed_at timestamptz
-- claim_review_comment text
-- remarks text (optional remarks/reason when timing out)
```

### Enums
- `attendance_status`: 'present', 'late', 'absent', 'pending'

### Related Tables and Relationships

#### profiles table
- id uuid primary key references auth.users (id) on delete cascade
- role user_role not null default 'intern'
- intern_id uuid references public.interns (id) on delete set null (cached link)
- supervisor_id uuid references public.supervisors (id) on delete set null (cached link)

#### interns table
- id uuid primary key default gen_random_uuid()
- profile_id uuid references public.profiles (id) on delete set null
- first_name text not null default ''
- last_name text
- full_name text generated always as (btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) stored
- department_id uuid references public.departments (id) on delete set null
- supervisor_id uuid references public.supervisors (id) on delete set null
- start_date date
- end_date date
- required_hours numeric not null default 300
- status intern_status not null default 'active'
- created_at timestamptz not null default now ()
- updated_at timestamptz not null default now ()

#### supervisors table
- id uuid primary key default gen_random_uuid()
- profile_id uuid references public.profiles (id) on delete set null
- department_id uuid references public.departments (id) on delete set null
- full_name text
- email text
- created_at timestamptz not null default now ()

### Key Functions

#### current_intern_id()
Resolves the current user's intern ID from either:
1. `interns.profile_id` joined to profiles (primary)
2. `profiles.intern_id` cached link (fallback)

```sql
create or replace function public.current_intern_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
select coalesce(
  (select i.id
     from public.interns i
     join public.profiles p on p.id = i.profile_id
  where p.id = auth.uid()),
  (select p.intern_id
     from public.profiles p
  where p.id = auth.uid()
    and p.intern_id is not null)
)
$$;
```

#### current_supervisor_id()
Resolves the current user's supervisor ID from either:
1. `supervisors.profile_id` (primary)
2. `profiles.supervisor_id` cached link (fallback)

```sql
create or replace function public.current_supervisor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
select coalesce(
  (select s.id
     from public.supervisors s
     where s.profile_id = auth.uid()
     limit 1),
  (select p.supervisor_id
     from public.profiles p
     where p.id = auth.uid())
)
$$;
```

#### current_supervisor_department_id()
Returns the department ID of the current supervisor:

```sql
create or replace function public.current_supervisor_department_id ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
select s.department_id
from public.supervisors s
join public.profiles p on p.id = s.profile_id
where p.id = auth.uid ();
$$;
```

### Attendance Hour Calculation Logic

#### In the database: No automatic calculation trigger
- `total_hours` is stored explicitly and must be set by the application
- The database only enforces `total_hours >= 0` via CHECK constraint

#### In the application code (attendanceService.js)

**timeOut method:**
```javascript
async timeOut(recordId, timeOutISO, remarks = null) {
  // ...
  // Calculate total hours from time_in to the provided timeOut
  const total = diffHours(existing.time_in, timeOutISO);
  // ...
  .update({
    time_out: timeOutISO,
    total_hours: total,
    remarks: remarks || null,
    method: "manual",
  })
}
```

**diffHours function (src/utils/format.js):**
```javascript
export function diffHours(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}
```
- Takes start and end ISO timestamps
- Returns decimal hours rounded to 2 decimal places
- Returns 0 if inputs are invalid or end <= start

**submitClaim method:**
- Intern submits a claimed time-out for an attendance record that has time_in but no time_out
- The claim is subject to supervisor approval
- On approval, `total_hours` is recomputed: `diffHours(existing.time_in, existing.claimed_time_out)`

**reviewClaim method:**
```javascript
if (decision === "approved") {
  patch.time_out = existing.claimed_time_out;
  patch.total_hours = diffHours(
    existing.time_in,
    existing.claimed_time_out,
  );
  patch.method = "claimed";
}
```

### Format/Utils Files

#### src/utils/format.js
Contains all date/time formatting and calculation utilities:

- `formatDate(value)` - Formats ISO date as "Mon DD, YYYY"
- `formatDateTime(value)` - Formats ISO datetime as "Mon DD, YYYY, HH:MM AM/PM"
- `formatTime(value)` - Formats ISO time as "HH:MM AM/PM"
- `todayDateInAttendanceTZ(now)` - Returns today's date as YYYY-MM-DD in Asia/Manila timezone
- `nowMinuteInAttendanceTZ(now)` - Returns current minute of day in Asia/Manila timezone
- `manilaWallTimeToISO(dateStr, hhmm)` - Converts Manila wall-clock date/time to UTC ISO instant
  - Asia/Manila is UTC+8 with no DST
  - Formula: `Date.UTC(y, m-1, d, hh, mm) - 8 * 60 * 60 * 1000`
- `diffHours(startISO, endISO)` - Computes decimal hours between two ISO timestamps
- `formatHours(hours)` - Formats decimal hours as "Xh Ym"
- `formatNumber(value)` - Formats number with thousands separators
- `getInitials(name)` - Gets initials from full name
- `timeAgo(value)` - Relative time like "2 hours ago"

### Attendance Flow

1. **timeIn**: Intern submits start of day
   - Checks for existing record for today
   - Inserts new record with `time_in: new Date().toISOString()`, `method`, `status: "present"`
   - `total_hours` defaults to 0

2. **timeOut**: Intern submits end of day
   - Calculates `total_hours = diffHours(time_in, timeOutISO)`
   - Updates `time_out`, `total_hours`, `method: "manual"`

3. **submitClaim**: Intern claims missed clock-out
   - Sets `claimed_time_out`, `claim_status: "pending"`, `claim_remarks`
   - Subject to supervisor approval

4. **reviewClaim**: Supervisor reviews claim
   - On approval: Sets `time_out = claimed_time_out`, `total_hours = diffHours(time_in, claimed_time_out)`, `method = "claimed"`
   - On rejection: Sets `status = "absent"`

### Intern/Profile Relationships

#### Link Structure
- **profiles.intern_id** → references **interns.id** (cached link)
- **profiles.supervisor_id** → references **supervisors.id** (cached link)
- **interns.profile_id** → references **profiles.id** (primary link)

#### Sync Triggers
- `sync_profile_links` trigger on interns/supervisors tables keeps profile links in sync
- `ensure_intern_links` trigger on interns BEFORE INSERT/UPDATE ensures profile_id and department_id are always populated
- `ensure_supervisor_links` trigger on supervisors BEFORE INSERT/UPDATE ensures profile_id is resolved

#### current_intern_id() Resolution Order
1. First tries: `interns.profile_id` → `profiles.id` where `p.id = auth.uid()`
2. Falls back to: `profiles.intern_id` where `p.id = auth.uid()` and `p.intern_id is not null`

### Seed Data

No seed data found in the codebase. The database migrations include:
- `0026_seed_admin.sql` - Seeds the initial admin account (email: plas-admin@company.com, password: 123123123)
- Various consistency and RLP fixes for existing data

### Required Hours
- Interns have `required_hours numeric not null default 300` in the interns table
- Programs have `hours_to_render numeric not null default 300` (renamed to `required_hours`)
- Admin settings have `required_hours numeric not null default 300`
- Default is 300 hours for the internship duration

### Attendance Per Day Constraint
- Unique index `attendance_unique_per_day` on `(intern_id, date)` prevents duplicate records
- This is a full unique index (not partial), so only ONE attendance record per intern per day is allowed
- The earlier partial index `attendance_open_unique` only prevented duplicate OPEN records (where time_out is null)