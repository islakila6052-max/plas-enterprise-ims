// src/lib/constants.js
/**
 * Application-wide constants. Single source of truth for roles, statuses and labels.
 */

export const ROLES = {
  ADMIN: "admin",
  SUPERVISOR: "supervisor",
  INTERN: "intern",
  HR_STAFF: "hr_staff",
};

export const ROLE_LABELS = {
  [ROLES.ADMIN]: "HR Administrator",
  [ROLES.SUPERVISOR]: "Supervisor",
  [ROLES.INTERN]: "Intern",
  [ROLES.HR_STAFF]: "HR Staff",
};

/** Roles that have full administrative privileges. */
export const ADMIN_ROLES = [ROLES.ADMIN, ROLES.HR_STAFF];

export const INTERN_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  ARCHIVED: "archived",
};

export const INTERN_STATUS_LABELS = {
  [INTERN_STATUS.ACTIVE]: "Active",
  [INTERN_STATUS.COMPLETED]: "Completed",
  [INTERN_STATUS.ARCHIVED]: "Archived",
};

/**
 * Attendance lateness rules.
 *
 * `SHIFT_START_MINUTE` is the scheduled start of the OJT shift in minutes after
 * midnight, expressed in the attendance timezone (Asia/Manila). Interns clocking
 * in at or before this time are `present`; anything later is `late`. Overtime is
 * not penalised — a late clock-in only changes the status label, never the
 * computed `total_hours`.
 */
export const SHIFT_START_MINUTE = 13 * 60; // 13:00 (1:00 PM)

export const ATTENDANCE_STATUS = {
  PRESENT: "present",
  LATE: "late",
  ABSENT: "absent",
  PENDING: "pending",
};

export const ATTENDANCE_STATUS_LABELS = {
  [ATTENDANCE_STATUS.PRESENT]: "Present",
  [ATTENDANCE_STATUS.LATE]: "Late",
  [ATTENDANCE_STATUS.ABSENT]: "Absent",
  [ATTENDANCE_STATUS.PENDING]: "Pending",
};

export const JOURNAL_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export const JOURNAL_STATUS_LABELS = {
  [JOURNAL_STATUS.PENDING]: "Pending",
  [JOURNAL_STATUS.APPROVED]: "Approved",
  [JOURNAL_STATUS.REJECTED]: "Rejected",
};

export const DOCUMENT_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export const DOCUMENT_STATUS_LABELS = {
  [DOCUMENT_STATUS.PENDING]: "Pending",
  [DOCUMENT_STATUS.APPROVED]: "Approved",
  [DOCUMENT_STATUS.REJECTED]: "Rejected",
};

export const DOCUMENT_TYPES = [
  { value: "resume", label: "Resume" },
  { value: "moa", label: "Memorandum of Agreement (MOA)" },
  { value: "endorsement", label: "Endorsement Letter" },
  { value: "school_requirements", label: "School Requirements" },
  { value: "completion_report", label: "Completion Report" },
];

export const ANNOUNCEMENT_CATEGORIES = [
  { value: "company_news", label: "Company News" },
  { value: "schedule", label: "Schedule Changes" },
  { value: "deadline", label: "Deadlines" },
  { value: "reminder", label: "Reminders" },
];

export const EVALUATION_CRITERIA = [
  { key: "attendance", label: "Attendance" },
  { key: "communication", label: "Communication" },
  { key: "teamwork", label: "Teamwork" },
  { key: "initiative", label: "Initiative" },
  { key: "technical_skills", label: "Technical Skills" },
  { key: "professionalism", label: "Professionalism" },
];

export const EVALUATION_RECOMMENDATIONS = [
  { value: "highly_recommend", label: "Highly Recommend" },
  { value: "recommend", label: "Recommend" },
  { value: "neutral", label: "Neutral" },
  { value: "do_not_recommend", label: "Do Not Recommend" },
];

export const PAGE_SIZE = 10;
export const SUPERVISOR_ROLES = [ROLES.SUPERVISOR];
export const INTERN_ROLES = [ROLES.INTERN];

// Combined list of all roles
export const ALL_ROLES = [...ADMIN_ROLES, ...SUPERVISOR_ROLES, ...INTERN_ROLES];
