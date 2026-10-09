# Internship Management System (IMS)

> A modern Internship Management System (IMS) built with React, Vite, Tailwind CSS, and Supabase.

---

# Project Overview

The Internship Management System (IMS) is designed to streamline internship management within a single organization. It provides separate portals for HR Administrators, Supervisors, and Interns while managing attendance, journals, evaluations, documents, and reports.

---

# Technology Stack

## Frontend

- React (Vite)
- Tailwind CSS
- React Router
- React Hook Form
- TanStack Query (Optional)

## Backend

- Supabase
  - Authentication
  - PostgreSQL Database
  - Storage
  - Row Level Security (RLS)

## Deployment

- Vercel

---

# User Roles

## HR Administrator

- Full system access
- Manage interns
- Manage supervisors
- Manage departments
- Approve attendance
- Review journals
- Generate reports
- Manage announcements
- Manage settings

---

## Supervisor

- View assigned interns
- Verify attendance
- Review daily journals
- Evaluate interns
- View reports related to assigned interns

---

## Intern

- Login
- Update profile
- View internship information
- Time In / Time Out
- Submit daily journals
- Upload required documents
- View attendance
- View evaluations
- View announcements

---

## HR Staff (Optional)

Limited administrative access.

- Manage documents
- Manage announcements
- Assist with intern records

---

# Development Phases

---

# Phase 1 — Project Setup

## Objectives

- Initialize React (Vite)
- Configure Tailwind CSS
- Connect Supabase
- Authentication setup
- Protected Routes
- Dashboard Layout
- Sidebar
- Navbar
- Role-based Routing

---

# Phase 2 — Authentication

## Features

- Login
- Logout
- Forgot Password
- Reset Password
- Change Password
- Profile Settings

---

# Phase 3 — Dashboards

Each role has its own dashboard.

## Admin Dashboard

Dashboard Cards

- Total Interns
- Active Interns
- Completed Internships
- Pending Evaluations
- Attendance Today

---

## Supervisor Dashboard

Dashboard Cards

- Assigned Interns
- Attendance Today
- Pending Journals
- Pending Evaluations

---

## Intern Dashboard

Dashboard Cards

- Hours Rendered
- Required Hours
- Remaining Hours
- Today's Attendance
- Latest Announcements

---

# Phase 4 — Intern Management

## HR Administrator

- Add Intern
- Edit Intern
- Archive Intern
- Assign Department
- Assign Supervisor
- Internship Start Date
- Internship End Date
- Required Hours

---

## Intern Profile

- Profile Photo
- Student Number
- Institution
- Program
- Contact Number
- Email
- Emergency Contact

---

# Phase 5 — Attendance Management

## Features

- Time In
- Time Out
- Manual Check-In
- QR Code Check-In (Optional)
- Attendance History

Automatically compute:

- Total Hours
- Remaining Hours
- Late
- Absent

---

# Phase 6 — Daily Journal

Intern submits:

- Date
- Activities
- Hours Worked
- Challenges
- Learnings

Supervisor actions:

- Approve
- Reject
- Add Comments

---

# Phase 7 — Document Management

Intern uploads:

- Resume
- Memorandum of Agreement (MOA)
- Endorsement Letter
- School Requirements
- Completion Report

Administrator actions:

- Approve
- Reject
- Download

Storage:

- Supabase Storage

---

# Phase 8 — Evaluation

Supervisor Evaluation

Criteria

- Attendance
- Communication
- Teamwork
- Initiative
- Technical Skills
- Professionalism

Additional fields

- Overall Rating
- Comments
- Final Recommendation

---

# Phase 9 — Announcements

Administrator can publish

- Company News
- Schedule Changes
- Deadlines
- Reminders

Interns and Supervisors can view announcements.

---

# Phase 10 — Reports

Generate reports for

- Attendance
- Daily Journals
- Intern List
- Evaluation Summary
- Hours Rendered

Export Options

- PDF
- Excel (Optional)

---

# Phase 11 — Settings

Administrator can manage

- Departments
- Internship Duration
- Required Hours
- Company Information

---

# Database Tables

The initial database design includes the following tables:

```
profiles
roles

interns
supervisors
departments

attendance
daily_journals

documents
evaluations

announcements

settings
```

---

# Sidebar Navigation

## HR Administrator

```
Dashboard

Interns

Attendance

Daily Journals

Documents

Evaluations

Announcements

Reports

Settings

Profile
```

---

## Supervisor

```
Dashboard

Assigned Interns

Attendance

Daily Journals

Evaluations

Profile
```

---

## Intern

```
Dashboard

My Attendance

Daily Journal

Documents

Evaluation

Announcements

Profile
```

---

# Recommended Folder Structure

```
src/
│
├── assets/
│
├── components/
│
├── pages/
│   ├── admin/
│   ├── supervisor/
│   └── intern/
│
├── layouts/
│
├── hooks/
│
├── services/
│
├── lib/
│
├── contexts/
│
├── routes/
│
├── utils/
│
├── types/
│
├── styles/
│
├── App.jsx
└── main.jsx
```

---

# Development Timeline

## Week 1

- Project Setup
- Supabase Integration
- Authentication
- Dashboard Layout
- Protected Routes

---

## Week 2

- Intern Management
- Supervisor Management
- User Profiles

---

## Week 3

- Attendance System
- Automatic Hour Computation

---

## Week 4

- Daily Journals
- Document Uploads

---

## Week 5

- Evaluations
- Announcements

---

## Week 6

- Reports
- Testing
- UI Improvements
- Deployment

---

# Project Scope

This Internship Management System focuses on the essential workflows required for a single organization.

Included Features

- User Authentication
- Role-Based Access Control
- Intern Management
- Supervisor Management
- Attendance Tracking
- Automatic Hour Computation
- Daily Journals
- Document Management
- Performance Evaluation
- Announcements
- Reports
- System Settings

Excluded Features

To keep the project focused and maintainable, the following are intentionally excluded:

- Multi-company support
- School administration portal
- SaaS subscription billing
- Payroll
- Recruitment system
- Multi-tenant architecture
- Advanced analytics
- AI features (future enhancement)

---

# Coding Standards

- Use functional React components.
- Prefer reusable components.
- Use Tailwind CSS for styling.
- Keep components modular and maintainable.
- Use React Router for navigation.
- Use Supabase for backend services.
- Follow clean folder organization.
- Use role-based route protection.
- Validate forms using React Hook Form.
- Keep business logic inside services or hooks.
- Write clean, readable, and documented code.

---

# Future Enhancements

Potential future features include:

- QR Code Attendance
- Push Notifications
- Email Notifications
- Calendar Integration
- Dark Mode
- Mobile Application
- Analytics Dashboard
- AI-powered Attendance Insights
- OCR Document Verification
- Facial Recognition Attendance
