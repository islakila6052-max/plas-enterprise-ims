# Admin Attendance Page — Documentation

## Overview

The Admin Attendance page (`src/pages/admin/AdminAttendance.jsx`) provides HR administrators and supervisors with a centralized view of organization-wide attendance records. It supports filtering by date and status, CSV export, and pagination.

## Location

- **Page component**: `src/pages/admin/AdminAttendance.jsx`
- **Route**: `/admin/attendance` (defined in the admin router)
- **Service**: `src/services/attendanceService.js` — `attendanceService.adminList()`
## Features

### Date Range Filter
- Two date inputs (**From** / **To**) filter records to a custom date range.
- Both are optional — leaving either empty means unbounded on that side.
- When either date changes, the table reloads with `page` reset to 1.
- If no dates are set, all records are shown.

### Status Filter
- A `<Select>` dropdown filters by attendance status: Present, Late, Absent, Pending.
- Selecting a status resets `page` to 1 and reloads the table.
- "All Statuses" (empty value) shows every record.

### 3. Table Columns
| Column | Description |
|---|---|
| Intern | Full name and student number |
| Date | The attendance date |
| Time In | Clock-in timestamp |
| Time Out | Clock-out timestamp (shows "Still in" if null) |
| Hours | Total hours computed from time_in → time_out |
| Status | Badge: Present (green), Late (amber), Absent (red), Pending (gray) |

### 4. Export CSV
- The **Export CSV** button in the header generates a CSV file from the currently filtered rows.
- Filename format: `attendance-YYYY-MM-DD.csv` (or `attendance-all.csv` if no date filter).
- Shows a loading spinner on the button while generating.

### 5. Pagination
- Pagination is shown when rows exceed `PAGE_SIZE` (defined in `@/lib/constants`).
- Page state is managed locally and resets on filter changes.

### 6. Loading States
- Initial load shows `<Spinner label="Loading attendance…" />`.
- CSV export shows a loading spinner on the Export button.

## Data Flow

```
AdminAttendance
  └─ attendanceService.adminList({ dateFrom, dateTo, page })
       └─ Supabase: SELECT * FROM attendance
            JOIN interns (for full_name, student_number)
            WHERE date >= ? AND date <= ? AND intern.supervisor_id = ?
            ORDER BY date DESC, time_in DESC
            LIMIT pageSize OFFSET (page-1)*pageSize
```

## Filtering Logic (Client-Side)

The `adminList` service returns all records for the supervisor's interns. The admin page applies an additional client-side status filter:

```js
if (status) data = data.filter((r) => r.status === status);
```

This means the date filter is handled server-side (via Supabase query), while the status filter is applied client-side after fetching.

## Constants Used

- `ATTENDANCE_STATUS` — enum values: `present`, `late`, `absent`, `pending`
- `ATTENDANCE_STATUS_LABELS` — human-readable labels
- `PAGE_SIZE` — rows per page (typically 15)

## Related Pages

- **Intern Attendance** (`/intern/attendance`) — intern's own daily check-in/out
- **Supervisor Attendance** (`/supervisor/attendance`) — supervisor's assigned interns
