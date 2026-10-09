# Project Plan — Internship Management System (IMS)

> Single source of truth for the Internship Management System (IMS).

## Overview
A modern Internship Management System for a single organization, with separate portals for HR Administrators, Supervisors, and Interns. Manages attendance, journals, evaluations, documents, and reports.

## Tech Stack
- **Frontend:** React (Vite), Tailwind CSS, React Router, React Hook Form, TanStack Query
- **Backend:** Supabase (Auth, PostgreSQL, Storage, RLS)
- **Deployment:** Vercel

## User Roles
- `admin` — HR Administrator (full access)
- `supervisor` — verifies attendance, reviews journals, evaluates interns
- `intern` — time in/out, journals, documents, views
- `hr_staff` — limited admin (documents, announcements, intern records)

## Database Tables
`profiles`, `roles`, `interns`, `supervisors`, `departments`, `attendance`, `daily_journals`, `documents`, `evaluations`, `announcements`, `settings`

## Folder Structure
```
src/
  assets/ components/ pages/{admin,supervisor,intern}/
  layouts/ hooks/ services/ lib/ contexts/ routes/ utils/ types/ styles/
```

## Phases
1. Project Setup — routing, layouts, auth, Supabase, protected routes, sidebar, navbar, role detection
2. Authentication — login, logout, forgot/reset/change password, profile settings
3. Dashboards — Admin, Supervisor, Intern (cards per spec)
4. Intern Management — full CRUD, assign supervisor/department, search, pagination, filters
5. Attendance — time in/out, manual, QR (optional), history, auto hour computation
6. Daily Journal — submit, approve/reject, comments
7. Documents — upload, approve/reject/download (Supabase Storage)
8. Evaluation — supervisor criteria, overall rating, recommendation
9. Announcements — publish, view
10. Reports — attendance/journals/intern list/evaluations/hours, export PDF/Excel
11. Settings — departments, duration, required hours, company info

## Coding Standards
Functional components, reusable UI, Tailwind styling, modular, role-based route protection, React Hook Form validation, business logic in services/hooks, clean documented code.
