# Admin Reports — System Overview & Data Flow

## Page Purpose
`AdminReports.jsx` provides a unified dashboard for generating internship management reports. The admin can select from five report types, configure filters, preview data in a table, and export to PDF or print. The page connects to five backend services and formats data using utility functions.

---

## Report Types & Data Sources

| Report Key | Label | Backend Service | Data Shape |
|---|---|---|---|
| `intern_list` | Intern List | `internService.list()` | Intern records with department, supervisor, institution, program relations |
| `attendance` | Attendance | `attendanceService.adminList()` | Attendance records with intern names, dates, time-in/out, hours, status |
| `journals` | Daily Journals | `journalService.list()` | Daily journal entries with intern names, dates, hours worked, status |
| `evaluations` | Evaluation Summary | `evaluationService.list()` | Evaluation records with intern names, overall rating (1–5), final recommendation |
| `hours` | Hours Rendered | `internService.list()` + `attendanceService.adminList()` | Intern names, required hours, rendered hours (computed from attendance) |

---

## Core Flow

### 1. State Initialization
```jsx
const [type, setType] = useState("intern_list");  // selected report type
const [busy, setBusy] = useState(false);          // loading state
const [preview, setPreview] = useState(null);     // preview data for table/PDF
const [filters, setFilters] = useState({});       // filter state per report type
```

### 2. Data Fetching (`fetchData`)
A `switch` statement routes the selected `type` to the appropriate service call. Each case maps raw DB rows to a flat object with human-readable keys. **Filter parameters are now passed from the filters state.**

#### Case: `intern_list`
- Calls `internService.list({ page: 1, pageSize: 1000, ...filters.intern_list })`
- Selects enriched relations: `department`, `supervisor`, `institution`, `program`
- Projects: `full_name`, `student_number`, `institution_name`, `program_name`, `status`, `required_hours`

#### Case: `attendance`
- Calls `attendanceService.adminList({ page: 1, pageSize: 1000, ...filters.attendance })`
- Selects `intern:full_name, student_number, supervisor_id`
- Maps: `Intern`, `Date`, `Time In`, `Time Out`, `Hours`, `Status`
- Uses `formatDate`, `formatTime`, `formatHours` from `src/utils/format.js`

#### Case: `journals`
- Calls `journalService.list({ page: 1, pageSize: 1000, ...filters.journals })`
- Selects `intern:full_name, student_number, profile_id`
- Maps: `Intern`, `Date`, `Hours Worked`, `Status`

#### Case: `evaluations`
- Calls `evaluationService.list({ page: 1, pageSize: 1000, ...filters.evaluations })`
- Selects `intern:full_name, student_number`
- Maps: `Intern`, `Overall Rating` (⟨score⟩/5), `Recommendation`

#### Case: `hours` (most complex)
- Parallel calls:
  - `internService.list({ page: 1, pageSize: 1000, ...filters.interns })` — gets all interns with `required_hours`
  - `attendanceService.adminList({ page: 1, pageSize: 5000, ...filters.attendance })` — gets all attendance records
- Computes `renderedByIntern` by reducing attendance records:
  ```js
  const renderedByIntern = (attRes.data ?? []).reduce((acc, r) => {
    if (r.intern_id) {
      acc[r.intern_id] = (acc[r.intern_id] ?? 0) + (Number(r.total_hours) || 0);
    }
    return acc;
  }, {});
  ```
- Maps each intern: `Name`, `Required Hours`, `Rendered Hours` (formatted)

### 3. Preview Generation (`generatePreview`)
- Sets `busy = true`
- Awaits `fetchData(filters[type])`
- On success: `setPreview(data)`
- On error: `toast.error(err.message)`
- Always: `setBusy(false)`

### 4. PDF Export (`exportPDF`)
- Re-fetches data via `fetchData(filters[type])`
- If empty: shows toast error
- Fetches company name from `settingsService.get()` (falls back to `"Internship Management System"`)
- Dynamically sets page orientation: `landscape` if >5 rows, otherwise `portrait`
- Uses `jspdf` + `jspdf-autotable` to build a styled table:
  - Header: company name + report label + generated timestamp
  - Table with auto-styled headers (auto-detected from data keys)
  - Alternating row colors, page numbering in footer
  - Saves as `IMS-{type}-Report.pdf`
- Shows success/error toast

### 5. Print Preview (`printPreview`)
- Requires prior preview generation
- Generates a simple HTML table and opens it in a new window for printing

### 6. Rendered UI
- **Report selector**: Buttons for each report type, visually indicating the active one
- **Filter badge**: Shows active filter count on each report button
- **Action buttons**: Preview, Download PDF, Print (disabled while loading)
- **Preview card** (shown after generation): Table component displaying the fetched data

---

## Service Integrations

### `internService`
- `list()` — fetches interns with optional filters (search, department, status, institution, program, created date range, supervisor)
- Uses Supabase `interns` table with joins to `departments`, `supervisors`, `institutions`, `programs`
- Supports soft-archive/restore via `status` flip

### `attendanceService`
- `adminList()` — admin-scoped attendance history with date range filtering, supervisor filtering, and now intern filtering and status filtering
- `timeIn()`, `timeOut()`, `submitClaim()`, `reviewClaim()` — individual attendance operations
- `diffHours()`, `formatHours()` — time math utilities

### `journalService`
- `list()` — daily journals with intern-supervisor-date filtering
- `create()`, `review()` — journal creation and status approval

### `evaluationService`
- `list()` — evaluation records with rating and recommendation filters

### `settingsService`
- `get()` — singleton settings row (id=1) containing `company_name` and other config

---

## Utility Functions (`src/utils/format.js`)

| Function | Purpose |
|---|---|
| `formatDate(value)` | ISO/date → `"Mon DD, YYYY"` |
| `formatTime(value)` | ISO → `"HH:MM TT"` |
| `formatHours(hours)` | Decimal → `"Xh Ym"` |
| `diffHours(startISO, endISO)` | Returns rounded decimal hours |
| `todayDateInAttendanceTZ()` | Returns `YYYY-MM-DD` in Asia/Manila (UTC+8) |
| `manilaWallTimeToISO(dateStr, hhmm)` | Converts wall-clock time to UTC ISO |

---

## Data Flow Diagram

```mermaid
graph TD
    A[AdminReports Component] -->|select report type| B[fetchData() switch]
    B -->|intern_list| C[internService.list()]
    B -->|attendance| D[attendanceService.adminList()]
    B -->|journals| E[journalService.list()]
    B -->|evaluations| F[evaluationService.list()]
    B -->|hours| G[internService.list() + attendanceService.adminList()]
    
    C -->|maps data| H[intern_list rows]
    D -->|maps data| H[attendance rows]
    E -->|maps data| H[journals rows]
    F -->|maps data| H[evaluations rows]
    G -->|computed rendered hours| H[hours rows]
    
    H -->|sets state| I[preview state]
    I -->|renders| J[Table preview]
    I -->|feeds| K[PDF export + print]
    
    K -->|settingsService.get()| L[company name]
    K -->|jspdf + autotable| M[PDF file]
    K -->|html window| N[print preview]

---

## Key Design Decisions

1. **Large page size (1000)** — All report fetches use `pageSize: 1000` (or 5000 for hours) to load all records in one request, avoiding pagination during report generation.

2. **Dynamic orientation** — PDF landscape is selected when the dataset exceeds 5 rows, ensuring readability.

3. **Header auto-formatting** — Column headers are derived from `Object.keys(data[0])` and auto-formatted via `replace(/([A-Z])/g, " $1")` to convert camelCase/`RequiredHours` into `Required Hours`.

4. **Timezone awareness** — Attendance data uses the Asia/Manila timezone (UTC+8, no DST) via `todayDateInAttendanceTZ()` and `formatTime()`.

5. **Graceful degradation** — All services wrap queries in error handling; UI shows toasts on failure but doesn't crash.

6. **Company config from settings** — The PDF header pulls the company name from a singleton `settings` table, allowing rebranding without code changes.

---

## Files Touched

- `src/pages/admin/AdminReports.jsx` — main component (updated with filter modal)
- `src/services/internService.js` — added `createdFrom`, `createdTo` parameters
- `src/services/attendanceService.js` — added `internId`, `status` parameters to `adminList()`
- `src/services/journalService.js` — added `dateFrom`, `dateTo`, `departmentId` parameters
- `src/services/evaluationService.js` — added `ratingMin`, `ratingMax`, `recommendation` parameters
- `src/services/settingsService.js` — unchanged
- `src/utils/format.js` — unchanged