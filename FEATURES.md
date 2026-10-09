# Internship Management System (IMS) — Feature Overview

> PLAS Enterprise · React + Vite + Tailwind + Supabase

---

## 🏗️ Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router 6 |
| Styling | Tailwind CSS (green brand palette) |
| Backend | Supabase (PostgreSQL + Auth + Realtime) |
| PDF Export | jsPDF + jspdf-autotable |
| Notifications | react-hot-toast + Supabase Realtime |
| State | React Context (Auth) |

---

## 👥 Roles & Access Control

Four distinct roles with role-based routing and sidebar navigation:

| Role | Routes | Permissions |
|---|---|---|
| **HR Administrator** | `/admin/*` | Full system access |
| **HR Staff** | `/admin/*` (limited) | Read-only + announcements, documents |
| **Supervisor** | `/supervisor/*` | Manage assigned interns |
| **Intern** | `/intern/*` | View own data + submit journals/docs |

Access is enforced via `ProtectedRoute` (auth) and `RoleRoute` (role). Unauthorized users are redirected to their role dashboard or login.

---

## 🔐 Authentication

- **Login** — Email/password with Supabase Auth
- **Forgot Password** — Email reset link
- **Reset Password** — Token-based reset
- **Change Password** — Authenticated users can update their password
- **Session persistence** — Auto-refreshes on auth state change
- **Auto-redirect** — After login, users are routed to their role dashboard

---

## 📊 Dashboard (Role-Specific)

### Admin Dashboard
- KPI cards: Total Interns, Active Interns, Completed Internships, Pending Evaluations, Attendance Today
- Donut chart: Intern status breakdown (Active / Completed / Pending Evals)
- Bar chart: Attendance today (Checked in vs not yet)
- Quick action links: Add Interns, Review Attendance, Generate Reports, Settings
- Program summary: Active vs Completed counts, pending evaluations, checked-in today

### Supervisor Dashboard
- KPI cards: Assigned Interns, Attendance Today, Pending Journals, Pending Evaluations
- Bar chart: Workload breakdown
- Quick links: View Assigned Interns, Review Journals, Submit Evaluations

### Intern Dashboard
- KPI cards: Hours Rendered, Required Hours, Remaining Hours, Today's Attendance, Latest Announcements
- Progress bar: Hours rendered vs required
- Bar chart: Progress to completion
- Quick links: Time In/Out, Submit Journal, Upload Documents, View Announcements

---

## 📋 Intern Management (Admin)

Full CRUD for interns with rich filtering and search:

- **Create** — Add new intern with full profile (name, student number, contact, email, emergency contact, department, supervisor, institution, program, start/end date, required hours, status)
- **Read** — Paginated table with search (name), filter by department/status, sortable columns
- **Update** — Edit intern details, reassign supervisor/institution/program
- **Delete** — Remove intern with confirmation dialog
- **Detail View** — Modal with full intern profile and statistics
- **Audit Trail** — All actions logged to `audit_logs`
- **Notifications** — Interns are notified on creation; supervisors are notified on assignment

---

## 📅 Attendance Management

### Admin Attendance
- Organization-wide attendance view with date range filtering (From/To)
- Status filter: Present, Late, Absent, Pending
- Search by intern name
- CSV export of filtered results
- Paginated table with intern name, date, time in/out, hours, status badge

### Supervisor Attendance
- View attendance of assigned interns only
- Search and status filtering
- Read-only view

### Intern Attendance (Self-Service)
- **Time In** — One-click check-in with confirmation dialog
- **Time Out** — One-click check-out with confirmation dialog
- **Daily limit** — Only one attendance record per day enforced
- **Real-time status** — Shows "Still in" for open sessions
- **Attendance history** — Last 30 days with status badges
- **Notifications** — Supervisor is notified on time-in and time-out
- **Audit logging** — Every time-in/time-out recorded

---

## 📝 Daily Journals

### Admin & Supervisor Journal Review
- Paginated list of all journal entries with search by intern name
- Filter by status: Pending, Approved, Rejected
- **Review modal** — View full journal content (activities, challenges, learnings) and add supervisor comment
- **Approve / Reject** — One-click decision with confirmation
- **Notifications** — Intern is notified when journal is reviewed
- **Audit logging** — All review actions recorded

### Intern Journal Submission
- Submit new daily journal entry with: date, activities, hours worked, challenges, learnings
- View own journal history with search
- Status badges (Pending / Approved / Rejected)
- **Notifications** — Supervisor is notified on new submission
- **Audit logging** — Submission recorded

---

## 📄 Document Management

### Admin Document Review
- Paginated table of all uploaded documents
- Filter by document type and status
- **Preview** — View document metadata in modal
- **Download** — Open file in new tab (public bucket or signed URL fallback)
- **Approve / Reject** — One-click review with confirmation
- **Notifications** — Intern is notified on review decision
- **Audit logging** — All review actions recorded

### Intern Document Upload
- Upload documents by type: Resume, MOA, Endorsement Letter, School Requirements, Completion Report
- File upload with type selection
- View own documents with status badges
- Download documents
- **Notifications** — Supervisor notified on upload (via review flow)

---

## 📊 Evaluations

### Supervisor Evaluations
- Create new evaluation for assigned interns
- Rate on 6 criteria (1-5): Attendance, Communication, Teamwork, Initiative, Technical Skills, Professionalism
- Overall rating (1-5)
- Final recommendation: Highly Recommend, Recommend, Neutral, Do Not Recommend
- Comments field
- **Notifications** — Intern is notified when evaluation is submitted
- **Audit logging** — Evaluation creation recorded

### Admin Evaluations (View All)
- Paginated table of all evaluations across all interns
- Search by intern name
- View evaluation details in modal with all criteria ratings
- Overall rating and recommendation displayed

### Intern Evaluation View
- View all evaluations submitted by supervisor
- Criteria ratings displayed in card layout
- Overall rating and recommendation
- Comments shown if present

---

## 📢 Announcements

### Admin Announcement Management
- Create / Edit / Delete announcements
- Categories: Company News, Schedule Changes, Deadlines, Reminders
- **Pin / Unpin** — Highlight important announcements
- Rich text body with title and category
- **Notifications** — All users (admin + supervisor + intern) notified on publish via fan-out
- **Audit logging** — All CRUD actions recorded

### Intern Announcements View
- See pinned announcements highlighted at top
- Recent announcements listed below
- Category badges and timestamps
- Read-only view

---

## 🏢 Institution & Program Management

### Admin Institution Management
- CRUD for educational institutions
- Search and sort institutions
- View institution detail page with:
  - Institution info (name, abbreviation, campus, address, contact)
  - Logo upload
  - Statistics: Total Programs, Active Interns, Completed Interns, Ongoing Internships
  - Interns by program breakdown
  - Programs table with CRUD (add/edit/delete programs)
- **Program reconciliation** — Programs are synced with institution on save

---

## 📈 Reports & Export

### Report Generation (Admin)
Five pre-built report types:
1. **Intern List** — Name, Student No., Institution, Program, Status, Required Hours
2. **Attendance** — Intern, Date, Time In/Out, Hours, Status
3. **Daily Journals** — Intern, Date, Hours Worked, Status
4. **Evaluation Summary** — Intern, Overall Rating, Recommendation
5. **Hours Rendered** — Name, Required Hours, Rendered Hours

Each report supports:
- **Preview** — Inline table preview before export
- **Download PDF** — Auto-formatted PDF with company header, report title, generated date, page numbers, and alternating row colors
- **Print** — Open print-ready HTML in new window
- Company name fetched from settings for PDF header

---

## 🔔 Notification System

- **Real-time** — Supabase Realtime subscriptions for instant notification delivery
- **Notification Bell** — Unread count badge in navbar
- **Dropdown** — Shows recent notifications with title, message, type, and read/unread status
- **Mark as Read** — Individual or mark-all
- **Click-to-navigate** — Notifications link to relevant pages
- **Fan-out** — Notifications broadcast to all admins, supervisors, and/or specific interns
- **Types**: account_created, announcement, journal_review, journal_submitted, evaluation_submitted, attendance_update, and more

---

## 🔍 Audit Logs

- **Admin-only** read-only audit trail
- Displays: timestamp, action (Create/Update/Delete/Login/Review), resource type, resource ID, user, and changes
- **Export to PDF** — Single clean PDF with all entries, auto-paginating table, header/footer with page numbers
- All user actions (CRUD, reviews, logins) are logged via `recordAudit()` service

---

## ⚙️ Settings

### Company Information
- Company name, internship duration, required hours
- Persisted via `settingsService.upsert()`

### Department Management
- CRUD for departments
- Used for assigning interns and supervisors

### Theme
- Green brand palette displayed as reference

---

## 👤 User Profile

- **Profile Settings** — Edit full name, contact number, bio
- **Change Password** — Authenticated password update
- **Avatar** — Displayed in sidebar and navbar
- **Role label** — Shown throughout the UI

---

## 🧩 UI Components Library

Reusable, accessible components used across the system:

| Component | Purpose |
|---|---|
| `PageHeader` | Standard page title + description + action slot |
| `Card` | Content container with border |
| `Table` | Responsive data table with custom columns |
| `Badge` | Color-coded status labels |
| `Button` | Primary/secondary/ghost/danger variants |
| `Modal` | Overlay dialog with footer actions |
| `ConfirmDialog` | Destructive action confirmation |
| `Spinner` | Loading indicator |
| `StatCard` | KPI metric card with icon and tone |
| `Pagination` | Page navigation |
| `SearchableSelect` | Async search dropdown |
| `Input` / `Select` / `Textarea` | Form fields with validation |
| `Avatar` | User profile image with initials fallback |
| `Chart` (BarChart, DonutChart) | Data visualization |
| `ErrorBoundary` | Graceful error handling |
| `EmptyState` | Friendly empty state illustration |

---

## 🔌 Services Layer

All data operations are centralized in service modules:

| Service | Purpose |
|---|---|
| `authService` | Login, logout, session, password reset |
| `profileService` | User profile CRUD |
| `userService` | Auth user creation |
| `internService` | Intern CRUD with filters |
| `attendanceService` | Attendance records, time-in/out |
| `journalService` | Journal CRUD and review |
| `documentService` | Document upload, download, review |
| `evaluationService` | Evaluation CRUD |
| `announcementService` | Announcement CRUD |
| `supervisorService` | Supervisor CRUD |
| `departmentService` | Department CRUD |
| `institutionService` | Institution CRUD + logo upload |
| `programService` | Program CRUD + reconciliation |
| `dashboardService` | Aggregated stats for each role |
| `settingsService` | Company settings CRUD |
| `notificationService` | Notification CRUD |
| `auditLogService` | Audit log CRUD + paginated fetch |
| `activityService` | Audit recording + notification fan-out |

---

## 🗄️ Key Database Tables

- `profiles` — User profiles linked to auth users
- `interns` — Intern records with status, hours, dates
- `supervisors` — Supervisor records linked to profiles
- `departments` — Organizational departments
- `institutions` — Educational institutions
- `programs` — Academic programs per institution
- `attendance` — Daily attendance records
- `daily_journals` — Intern journal entries
- `documents` — Uploaded files with status
- `evaluations` — Supervisor evaluations with criteria scores
- `announcements` — Company announcements with categories
- `notifications` — Per-user notifications
- `audit_logs` — Immutable action trail
- `settings` — Company configuration

---

## 🎨 Design System

- **Brand Colors** — Green palette (`#15803D` primary, `#16A34A` secondary, `#22C55E` accent)
- **Layout** — Sidebar (collapsible, dark green) + Top Navbar (sticky, glassmorphism)
- **Typography** — Tailwind default scale, slate color palette
- **Icons** — Lucide icons via shared `Icon` component
- **Responsive** — Mobile-first with `lg:` breakpoints, collapsible sidebar on mobile
- **Animations** — Subtle fade-up animations, hover transitions
- **Toast** — react-hot-toast for non-blocking feedback

---

*Last updated: July 2026*
