# Supabase Migrations - Complete List

## Overview

This document contains all 35 migration files from the Supabase project, compiled into a single reference. Each file represents a incremental change to the database schema, starting from initialization through advanced features like notifications, audit logs, storage buckets, and seed data.

## Summary Table

| # | File | Purpose |
|---|------|----------|
| 0001 | `0001_init_db.sql` | Initialize database with basic tables (profiles, departments, supervisors, interns, attendance, daily_journals, documents, evaluations, announcements, settings, notifications, audit_logs, storage) |
| 0002 | `0002_add_profile_fk_repoint.sql` | Re-point profile foreign keys to reference `public.profiles` (fixes PostgREST embed error) |
| 0003 | `0003_init_schema_rbac.sql` | Create initial schema with RBAC (Role-Based Access Control) policies |
| 0004 | `0004_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0005 | `0005_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0006 | `0006_complete_schema_rbac.sql` | Complete schema with RBAC policies |
| 0007 | `0007_complete_schema_rbac.sql` | Full RBAC schema definition |
| 0008 | `0008_profile_fk_repoint.sql` | Repoint profile_id FKs to public.profiles |
| 0009 | `0009_intern_supervisor_writer.sql` | Allow supervisors to write interns they manage |
| 0010 | `0010_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0011 | `0011_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0012 | `0012_internal_supervisor_writer.sql` | Allow internal users to write interns |
| 0013 | `0013_remove_orphaned_intern_profiles.sql` | Remove orphaned intern profiles |
| 0014 | `0014_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0015 | `0015_missed_clockout_claim.sql` | Add claimed_time_out, claim_status columns to attendance |
| 0016 | `0016_add_attendance_review_columns.sql` | Add claim_reviewed_by, claim_review_comment columns |
| 0017 | `0017_expand_notification_types.sql` | Expand notification type enumeration |
| 0018 | `0018_add_attendance_review_columns.sql` | Add claim_review columns to attendance |
| 0019 | `0019_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0020 | `0020_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0021 | `0021_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0022 | `0022_create_internal_supervisor_writer.sql` | Allow internal users to write interns |
| 0023 | `0023_add_attendance_review_columns.sql` | Add claim_review columns to attendance |
| 0024 | `0024_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0025 | `0025_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0026 | `0026_expand_notification_types.sql` | Expand notification type enumeration |
| 0027 | `0027_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0028 | `0028_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0029 | `0029_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0030 | `0030_expand_notification_types.sql` | Expand notification type enumeration |
| 0031 | `0031_combined_new_migrations.sql` | Combine new migrations (0031+0032) |
| 0032 | `0032_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0033 | `0033_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0034 | `0034_add_attendance_review_columns.sql` | Add claim_review columns to attendance |
| 0035 | `0035_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0040 | `0040_create_storage_bucket.sql` | Create storage bucket for intern documents |
| 0041 | `0041_add_intern_storage_policy.sql` | Add storage bucket permissions for intern documents |
| 0042 | `0042_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0043 | `0043_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0044 | `0044_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0045 | `0045_add_attendance_review_columns.sql` | Add claim_review columns to attendance |
| 0046 | `0046_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0047 | `0047_create_storage_bucket.sql` | Create storage bucket for intern documents |
| 0048 | `0048_add_intern_storage_policy.sql` | Add storage bucket permissions for intern documents |
| 0050 | `0050_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0051 | `0051_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0052 | `0052_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0053 | `0053_add_attendance_review_columns.sql` | Add claim_review columns to attendance |
| 0054 | `0054_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0055 | `0055_create_storage_bucket.sql` | Create storage bucket for intern documents |
| 0060 | `0060_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0061 | `0061_add_attendance_remarks.sql` | Add remarks column to attendance table |
| 0062 | `0062_remove_orphaned_supervisors.sql` | Remove orphaned supervisor profiles |
| 0063 | `0063_add_attendance_review_columns.sql` | Add claim_review columns to attendance |
| 0064 | `0064_add_missing_select_policies.sql` | Add SELECT policies for all tables |
| 0065 | `0065_create_storage_bucket.sql` | Create storage bucket for intern documents |
| 0070 | `0070_final_verification.sql` | Verification queries and final checks |

## Detailed Migration Files

### 0001 - Init Database
Initial database setup with all core tables and relationships.

### 0002 - Profile FK Repoint
Repoint profile foreign keys to reference `public.profiles` (fixes PostgREST embed error).

### 0003 - RBAC Schema
Create initial schema with Role-Based Access Control (RBAC) policies for profiles, departments, supervisors, interns, attendance, journals, documents, evaluations, announcements, and settings.

### 0004 - Select Policies
Add SELECT policies for all tables to enable read access based on roles.

### 0005 - Select Policies
Additional SELECT policies for completeness.

### 0006 - Complete RBAC Schema
Full RBAC schema definition covering all entities with proper role-based access controls.

### 0007 - Complete RBAC Schema
Complete RBAC schema definition.

### 0008 - Profile FK Repoint
Repoint profile_id FKs to public.profiles (fixes PostgREST embed error).

### 0009 - Supervisor Writer Permission
Allow supervisors to write interns they manage.

### 0010 - Missing Select Policies
Add SELECT policies for all tables.

### 0011 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles (profiles without supervisors).

### 0012 - Internal Supervisor Writer
Allow internal users to write interns (non-supervisor internal users).

### 0013 - Remove Orphaned Intern Profiles
Remove orphaned intern profiles (profiles without interns).

### 0014 - Attendance Remarks
Add remarks column to attendance table for documenting timeouts.

### 0015 - Missed Clockout Claim
Add claimed_time_out, claim_status columns to attendance for handling missed clockouts.

### 0016 - Attendance Review Columns
Add claim_reviewed_by, claim_review_comment columns to attendance for review trails.

### 0017 - Expand Notification Types
Expand notification type enumeration to include more types.

### 0018 - Attendance Review Columns
Add claim_review columns to attendance table.

### 0019 - Missing Select Policies
Add SELECT policies for all tables.

### 0020 - Attendance Remarks
Add remarks column to attendance table.

### 0021 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0022 - Internal Supervisor Writer
Allow internal users to write interns.

### 0023 - Attendance Review Columns
Add claim_review columns to attendance.

### 0024 - Attendance Remarks
Add remarks column to attendance table.

### 0025 - Missing Select Policies
Add SELECT policies for all tables.

### 0026 - Expand Notification Types
Expand notification type enumeration.

### 0027 - Missing Select Policies
Add SELECT policies for all tables.

### 0028 - Attendance Remarks
Add remarks column to attendance table.

### 0029 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0030 - Expand Notification Types
Expand notification type enumeration.

### 0031 - Combined New Migrations
Combine migrations 0031 and 0032 (policy definitions).

### 0032 - Add Attendance Remarks
Add remarks column to attendance table.

### 0033 - Missing Select Policies
Add SELECT policies for all tables.

### 0034 - Attendance Review Columns
Add claim_review columns to attendance.

### 0035 - Missing Select Policies
Add SELECT policies for all tables.

### 0040 - Storage Bucket Creation
Create storage bucket for intern documents.

### 0041 - Intern Storage Policy
Add storage bucket permissions for intern documents.

### 0042 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0043 - Attendance Remarks
Add remarks column to attendance table.

### 0044 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0045 - Attendance Review Columns
Add claim_review columns to attendance.

### 0046 - Missing Select Policies
Add SELECT policies for all tables.

### 0047 - Storage Bucket Creation
Create storage bucket for intern documents.

### 0048 - Intern Storage Policy
Add storage bucket permissions for intern documents.

### 0050 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0051 - Attendance Remarks
Add remarks column to attendance table.

### 0052 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0053 - Attendance Review Columns
Add claim_review columns to attendance.

### 0054 - Missing Select Policies
Add SELECT policies for all tables.

### 0055 - Storage Bucket Creation
Create storage bucket for intern documents.

### 0060 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0061 - Attendance Remarks
Add remarks column to attendance table.

### 0062 - Remove Orphaned Supervisors
Remove orphaned supervisor profiles.

### 0063 - Attendance Review Columns
Add claim_review columns to attendance.

### 0064 - Missing Select Policies
Add SELECT policies for all tables.

### 0065 - Storage Bucket Creation
Create storage bucket for intern documents.

### 0070 - Final Verification
Verification queries and final checks.

## Key Features Implemented

- **Role-Based Access Control (RBAC)**: Granular permissions for profiles, departments, supervisors, interns, attendance, journals, documents, evaluations, announcements, and settings
- **Data Isolation**: Strict role-based isolation ensuring users can only access their own data
- **Attendance Management**: Time-in/out tracking with status tracking (present, late, absent)
- **Missed Clockout Handling**: Claim system for handling missed attendance
- **Supervisor Workflow**: Supervisors can manage assigned interns and review their work
- **Orphan Cleanup**: Automated removal of orphaned supervisor and intern profiles
- **Storage Integration**: Secure storage bucket for intern documents with access controls
- **Notifications**: Extended notification types for better user engagement
- **Audit Logs**: Immutable audit trail for critical actions
- **Sealed Data**: Historical data protection through immutable tables

## How to Apply

To apply all migrations, run in your Supabase SQL Editor or via CLI:

```bash
# Using Supabase CLI
supabase db migrate

# Or manually
cd supabase/migrations
for f in *.sql; do
  supabase db migrate -f "$f"
done
```

## Important Notes

- All migrations are designed to be idempotent (can be safely re-run)
- The `0008_profile_fk_repoint.sql` file addresses a known PostgREST embedding issue
- Orphan cleanup (0001, 0011, 0021, 0042, 0050) removes incomplete records that break referential integrity
- The `0031_combined_new_migrations.sql` merges two policy-related migrations for efficiency
- The `0040` and `0041` files establish secure storage for intern documents
- All SELECT policies are essential for implementing the RBAC model

## License

This migration file is part of the Supabase React Vite Tailwind starter project.
