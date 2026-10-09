# Plan: Add Date Range Picker to Admin Attendance Page

## Goal

Replace the single date filter on the Admin Attendance page with a **date range picker** (from/to) so administrators can view attendance over a custom period.

## Current State

- **File**: `src/pages/admin/AdminAttendance.jsx`
- **Current filter**: Single `<Input type="date">` bound to `date` state
- **Backend**: `attendanceService.adminList({ date, page })` filters by exact date via `eq("date", date)`
- **Client-side**: Status filter applied after fetch

## Changes Required

### 1. State Changes (`AdminAttendance.jsx`)

Replace:
```js
const [date, setDate] = useState("");
```

With:
```js
const [dateFrom, setDateFrom] = useState("");
const [dateTo, setDateTo] = useState("");
```

### 2. Backend Service (`attendanceService.js`)

Update `adminList` to accept `dateFrom` and `dateTo` instead of `date`, and apply `gte` / `lte` filters:

```js
async adminList({ dateFrom, dateTo, supervisorId, page = 1, pageSize = 15 } = {}) {
  let query = supabase
    .from("attendance")
    .select("*, intern:interns(full_name, student_number, supervisor_id)", { count: "exact" })
    .order("date", { ascending: false })
    .order("time_in", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (dateFrom) query = query.gte("date", dateFrom);
  if (dateTo) query = query.lte("date", dateTo);
  if (supervisorId) query = query.eq("intern.supervisor_id", supervisorId);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { data: data ?? [], count: count ?? 0 };
}
```

### 3. UI Changes (`AdminAttendance.jsx`)

Replace the single date `<Input>` with two date inputs in a flex row:

```jsx
<div className="grid gap-3 border-b border-brand-100 p-4 sm:grid-cols-3">
  <Input
    type="date"
    value={dateFrom}
    onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
    className="max-w-xs"
    label="From"
  />
  <Input
    type="date"
    value={dateTo}
    onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
    className="max-w-xs"
    label="To"
  />
  <Select
    value={status}
    onChange={(e) => { setStatus(e.target.value); setPage(1); }}
    className="max-w-xs"
  >
    ...
  </Select>
</div>
```

### 4. Load Function Update

Update the `load` callback's dependency and service call:

```js
const load = useCallback(async () => {
  setLoading(true);
  try {
    const res = await attendanceService.adminList({ dateFrom, dateTo, page });
    let data = res.data;
    if (status) data = data.filter((r) => r.status === status);
    setRows(data);
    setTotal(res.count);
  } catch (err) {
    toast.error(err.message);
  } finally {
    setLoading(false);
  }
}, [dateFrom, dateTo, status, page]);
```

### 5. CSV Export Filename

Update the export filename to reflect the range:

```js
a.download = `attendance-${dateFrom || "from-start"}-${dateTo || "to-end"}.csv`;
```

### 6. Optional: Clear Filters Button

Add a small "Clear filters" button that resets both date inputs and status:

```jsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => {
    setDateFrom("");
    setDateTo("");
    setStatus("");
    setPage(1);
  }}
>
  Clear filters
</Button>
```

## Migration / Database

No database migration is needed. The `attendance` table already has a `date` column with a `btree` index (`attendance_date_idx`), and `gte` / `lte` filters on a `date` column will use that index efficiently.

## Files to Modify

| File | Change |
|---|---|
| `src/pages/admin/AdminAttendance.jsx` | Replace single date with from/to inputs; update state, load, and export |
| `src/services/attendanceService.js` | Update `adminList` to accept `dateFrom`/`dateTo` with `gte`/`lte` |

## Files to Add (optional)

| File | Purpose |
|---|---|
| `docs/admin-attendance.md` | Documentation for the attendance page (already created) |

## Testing Checklist

- [ ] Date range picker renders two date inputs side by side
- [ ] Selecting "From" date loads records on or after that date
- [ ] Selecting "To" date loads records on or before that date
- [ ] Selecting both dates loads records within the range (inclusive)
- [ ] Clearing both dates shows all records
- [ ] Status filter still works in combination with date range
- [ ] Pagination resets to page 1 on filter change
- [ ] CSV export filename reflects the date range
- [ ] No duplicate API calls when both dates change rapidly
- [ ] Loading spinner appears during fetch

## UI Mockup (text)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Attendance                                          [Export CSV]    │
├─────────────────────────────────────────────────────────────────────┤
│  From: [2026-07-01]   To: [2026-07-31]   [All Statuses ▼]         │
├─────────────────────────────────────────────────────────────────────┤
│  Intern          │ Date       │ Time In │ Time Out │ Hours │ Status│
│  ─────────────── │ ────────── │ ─────── │ ──────── │ ───── │ ──────│
│  John Doe        │ 2026-07-15 │ 08:00   │ 17:00    │ 9.0   │ Present│
│  ...             │ ...        │ ...     │ ...      │ ...   │ ...    │
├─────────────────────────────────────────────────────────────────────┤
│  ← Previous  1  2  3  Next →                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Priority

**Medium** — improves admin usability for weekly/monthly reports without requiring a full redesign.
