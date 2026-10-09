# Internship Management System — Workflow Reference

> Reverse-engineered from the codebase (`src/pages/*`, `src/services/*`, `src/routes/*`,
> `src/contexts/AuthContext.jsx`, `src/lib/constants.js`, `src/lib/navigation.js`, `src/App.jsx`).
> This document describes the actual flows implemented in the app, organized as **swimlane diagrams**
> (one lane per actor/role) using Mermaid.

---

## 1. Actors / Swimlanes

| Lane | Role | Entry points |
| --- | --- | --- |
| **System / Supabase** | Auth + DB + Storage | `auth.users`, `profiles` (auto-created), RLS |
| **HR Admin / HR Staff** | `admin`, `hr_staff` | `/admin/*` |
| **Supervisor** | `supervisor` | `/supervisor/*` |
| **Intern** | `intern` | `/intern/*` |

Route gating (from `src/App.jsx` + `src/routes/RoleRoute.jsx`):
- `/admin/*` → `RoleRoute roles={["admin","hr_staff"]}`
- `/supervisor/*` → `RoleRoute roles={["supervisor"]}`
- `/intern/*` → `RoleRoute roles={["intern"]}`
- All app routes wrapped in `ProtectedRoute` (requires authenticated user with a resolved `profile.role`).

---

## 2. Authentication & Profile Bootstrap

Every session begins here. The `on_auth_user_created` trigger provisions a `profiles` row; the
`AuthContext` loads it and exposes `role`, `internId`, `supervisorId`.

```mermaid
flowchart LR
    subgraph Intern[Intern / Any User]
        A1[Open App] --> A2[Login: email + password]
        A2 --> A3[Forgot Password?]
        A3 -->|yes| A4[request reset email]
        A4 --> A5[Reset Password page -> updateUser]
        A5 --> A2
    end
    subgraph Sys[System / Supabase]
        B1[signInWithPassword] --> B2[onAuthStateChange]
        B2 --> B3[(auth.users)]
        B3 -->|trigger| B4[(profiles row auto-created)]
    end
    subgraph Ctx[AuthContext]
        C1[getCurrentUser] --> C2[loadProfile -> profileService.getByUserId]
        C2 --> C3[expose role / internId / supervisorId]
        C3 --> C4{RoleRoute gate}
    end
    A2 --> B1
    B2 --> C1
    C4 -->|admin/hr_staff| D1[/admin dashboard/]
    C4 -->|supervisor| D2[/supervisor dashboard/]
    C4 -->|intern| D3[/intern dashboard/]
```

---

## 3. Intern Lifecycle (cross-role swimlane)

This is the core end-to-end flow spanning all three roles.

```mermaid
flowchart TD
    subgraph HR[HR Admin]
        H1[Intern Management: Add Intern] --> H2[assign department + supervisor]
        H2 --> H3[(interns row: status=active)]
        H4[Archive / Restore] --> H3
        H5[Settings: company info + required hours] --> H6[(settings singleton)]
    end
    subgraph SUP[Supervisor]
        S1[View Assigned Interns] --> S2[Review Daily Journals]
        S2 -->|approve/reject + comment| S3[(daily_journals.status)]
        S4[Submit Evaluation] --> S5[(evaluations: status=pending)]
    end
    subgraph INT[Intern]
        I1[Time In / Time Out] --> I2[(attendance + total_hours)]
        I3[Submit Daily Journal] --> I4[(daily_journals: status=pending)]
        I5[Upload Documents] --> I6[(documents: status=pending)]
        I7[View own Evaluation]
    end
    subgraph HR2[HR Admin]
        J1[Review Attendance] --> J2[(attendance)]
        J3[Review Journals] --> J4[(daily_journals)]
        J5[Review Documents: approve/reject] --> J6[(documents.status)]
        J7[View Evaluations] --> J8[(evaluations)]
        J9[Publish Announcements] --> J10[(announcements)]
        J11[Generate Reports] --> J12[PDF / Excel export]
    end

    H3 --> I1
    H3 --> I3
    H3 --> I5
    I4 --> S2
    I6 --> J5
    I2 --> J1
    S3 --> J3
    S5 --> J7
    J10 --> I7
    J8 --> I7
```

---

## 4. Daily Attendance Workflow

```mermaid
flowchart LR
    subgraph INT[Intern]
        A[InternAttendance] --> B[getOpen: time_out is null?]
        B -->|no open record| C[Time In -> attendanceService.timeIn]
        B -->|open record exists| D[Time Out -> attendanceService.timeOut]
        C --> E[(attendance: time_in, status=present)]
        D --> F[compute total_hours client-side]
        F --> G[(attendance: time_out, total_hours)]
    end
    subgraph HR[HR Admin]
        H[AdminAttendance] --> I[adminList all + filter by date/status]
        I --> J[(attendance)]
    end
    subgraph SUP[Supervisor]
        K[SupervisorAttendance] --> L[adminList filtered to assigned interns]
        L --> M[(attendance)]
    end
    E --> H
    G --> H
    E --> K
    G --> K
```

Notes:
- `attendanceService.timeIn` inserts `status='present'`; `timeOut` computes hours via `diffHours()` in
  `src/utils/format.js` (client-side, not a DB trigger).
- A partial unique index `attendance_open_unique` enforces **one open record per intern per day**.

---

## 5. Daily Journal Workflow

```mermaid
flowchart TD
    subgraph INT[Intern]
        A[InternJournal: submit] --> B[(daily_journals: status=pending)]
    end
    subgraph SUP[Supervisor]
        C[SupervisorJournals: review] --> D{Decision}
        D -->|approve| E[(daily_journals: status=approved)]
        D -->|reject| F[(daily_journals: status=rejected)]
        D --> G[set supervisor_comment]
    end
    subgraph HR[HR Admin]
        H[AdminJournals: review] --> I{Decision}
        I -->|approve| E
        I -->|reject| F
        I --> G
    end
    B --> C
    B --> H
    E --> J[Intern sees reviewed journal]
    F --> J
```

Notes:
- Admin review passes `supervisor_id = null` (admin acts, not a supervisor). Supervisor review passes
  their own `supervisorId`.

---

## 6. Document Workflow

```mermaid
flowchart TD
    subgraph INT[Intern]
        A[InternDocuments: choose type + file] --> B[documentService.upload]
        B --> C[storage: intern-documents bucket, folder = internId]
        C --> D[(documents: status=pending, file_path, file_url, file_name)]
    end
    subgraph HR[HR Admin]
        E[AdminDocuments: review] --> F{Decision}
        F -->|approve| G[(documents: status=approved)]
        F -->|reject| H[(documents: status=rejected)]
        E --> I[download via signed URL / remove]
    end
    D --> E
    G --> J[Intern sees status]
    H --> J
```

Notes:
- Storage RLS: intern can `INSERT` only into a folder named with their own `current_intern_id()`;
  admins have full `ALL` on the bucket.

---

## 7. Evaluation Workflow

```mermaid
flowchart TD
    subgraph SUP[Supervisor]
        A[SupervisorEvaluations: New Evaluation] --> B[select intern + 6 criteria + recommendation]
        B --> C[(evaluations: status=pending, supervisor_id)]
    end
    subgraph HR[HR Admin]
        D[AdminEvaluations: view] --> E[(evaluations)]
    end
    subgraph INT[Intern]
        F[InternEvaluation: view own] --> G[(evaluations where intern_id = me)]
    end
    C --> D
    C --> F
```

Notes:
- `evaluations.status` is the `evaluation_status` enum (`pending`/`completed`/`archived`). New
  evaluations are created as `pending`, which feeds the "Pending Evaluations" dashboard counters.
- Criteria: `attendance, communication, teamwork, initiative, technical_skills, professionalism`
  (each 0–5) + `overall_rating` + `final_recommendation`.

---

## 8. Announcements Workflow

```mermaid
flowchart LR
    subgraph HR[HR Admin]
        A[AdminAnnouncements: create/edit] --> B[(announcements: published_by, pinned, category)]
        C[Toggle Pin]
    end
    subgraph INT[Intern]
        D[InternAnnouncements: view] --> E[pinned first, then recent]
    end
    subgraph SUP[Supervisor]
        F[Supervisor/Admin dashboards] --> G[count + latest]
    end
    B --> D
    B --> F
    C --> B
```

---

## 9. Reports Workflow (client-side aggregation)

```mermaid
flowchart LR
    subgraph HR[HR Admin]
        A[AdminReports] --> B{Select report type}
        B -->|intern_list / attendance / journals / evaluations / hours| C[service.list across tables]
        C --> D[build row objects]
        D --> E[Preview / Export Excel (xlsx) / Export PDF (jspdf)]
    end
```

Notes:
- There is **no `reports` table**. Reports are computed in `AdminReports.jsx` by aggregating
  `interns`, `attendance`, `daily_journals`, and `evaluations`.

---

## 10. Profile & Settings Workflow

```mermaid
flowchart LR
    subgraph ANY[Any authenticated user]
        A[ProfileSettings] --> B[profileService.update: full_name, contact_number, bio]
        C[ChangePassword] --> D[authService.updatePassword]
    end
    subgraph HR[HR Admin]
        E[AdminSettings] --> F[departments CRUD]
        E --> G[settingsService.upsert: company_name, internship_duration, required_hours]
    end
```

---

## 11. Permission / Visibility Matrix (per swimlane)

| Capability | HR Admin / HR Staff | Supervisor | Intern |
| --- | --- | --- | --- |
| Manage interns / supervisors / departments | ✅ | ❌ | ❌ |
| Time in/out | (all attendance) | view assigned | own |
| Submit daily journal | (all) | review assigned | own |
| Upload documents | review all | (read) | own |
| Evaluate | view all | create for assigned | view own |
| Publish announcements | ✅ | ❌ | ❌ |
| Generate reports | ✅ | ❌ | ❌ |
| Edit company settings | ✅ | ❌ | ❌ |
| Edit own profile / password | ✅ | ✅ | ✅ |

All data access is additionally enforced by **Row Level Security** (see `DATABASE_SCHEMA.md` §12),
so the UI gates above are defense-in-depth, not the only control.

---

## 12. End-to-End Summary (single timeline)

```mermaid
flowchart TD
    Start[Login] --> Profile[Profile auto-created + loaded]
    Profile --> Dash[Role-based Dashboard]
    Dash --> AddIntern[HR adds intern + assigns supervisor]
    AddIntern --> Attend[Intern clocks in/out daily]
    Attend --> Journal[Intern submits daily journal]
    Journal --> Doc[Intern uploads documents]
    Doc --> SupReview[Supervisor reviews journals + evaluates]
    SupReview --> HRReview[HR reviews/approves documents + journals]
    HRReview --> Announce[HR publishes announcements]
    Announce --> Report[HR exports reports]
    Report --> Complete[Internship status -> completed/archived]
```

---

*Generated from the IMS codebase. Every node maps to a real page (`src/pages/*`), service
(`src/services/*`), or database object (`DATABASE_SCHEMA.sql`).*
