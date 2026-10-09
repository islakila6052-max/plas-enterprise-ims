# 4 — Flash

All frontend work — the database is locked down, now strip the supervisor's creation UI and verify.

---

## Task F1 — Remove "+ Add Intern" button & creation Modal

**File:** `src/pages/supervisor/SupervisorInterns.jsx`

1. Remove the `action` prop from `PageHeader` (line 192):

```jsx
// Before:
<PageHeader
  title="Assigned Interns"
  description="Interns under your supervision or created by you."
  action={<Button onClick={openCreate}>+ Add Intern</Button>}
/>

// After:
<PageHeader
  title="Assigned Interns"
  description="Interns under your supervision."
/>
```

2. Delete the entire creation modal block — the `<Modal>` with `open={modalOpen}` and `title="Add Intern"` (lines 263–330).

---

## Task F2 — Remove creation state, `useForm`, `EMPTY`, and creation functions

**File:** `src/pages/supervisor/SupervisorInterns.jsx`

1. Delete the `EMPTY` constant (lines 27–37).
2. Delete these state declarations (lines 46–50):

```js
const [modalOpen, setModalOpen] = useState(false);
const [saving, setSaving] = useState(false);
const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
const [institutionLabel, setInstitutionLabel] = useState("");
const [selectedProgramId, setSelectedProgramId] = useState("");
const [programLabel, setProgramLabel] = useState("");
```

3. Delete the entire `useForm` destructuring block (lines 78–84): `register`, `handleSubmit`, `reset`, `setValue`, `errors`.
4. Delete these function definitions entirely:
   - `openCreate` (lines 86–93)
   - `onInstitutionSearch` (lines 95–101)
   - `onProgramSearch` (lines 104–112)
   - `handleInstitutionSelect` (lines 114–120)
   - `onSubmit` (lines 122–185)
5. Delete the imports identified in Task H1 above.

---

## Task F5 — Update copy text referencing supervisor intern creation

**File:** `src/pages/admin/AdminSupervisors.jsx`

Line 332 — change helper text:

```jsx
// Before:
<p className="text-xs text-slate-500">
  Supervisor will receive these credentials and can create interns.
</p>

// After:
<p className="text-xs text-slate-500">
  Supervisors can view and manage their assigned interns.
</p>
```

**File:** `src/pages/supervisor/SupervisorInterns.jsx`

Already handled in Task F1. Confirm the description now reads `"Interns under your supervision."` with no other references to creation.

---

## Task F6 — Run build verification

**Command:** `npm run build` in `react-vite-tailwind-starter`

Confirm exit code 0, no import errors, no unresolved references. If the build fails, relay the exact error lines to the higher model for diagnosis.
