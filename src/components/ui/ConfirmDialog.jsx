// src/components/ui/ConfirmDialog.jsx
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

/**
 * Reusable confirmation dialog. Use for destructive or important actions
 * (delete, archive, reject) so the user must explicitly confirm.
 *
 * Props: open, onClose, onConfirm, title, message, confirmLabel, tone
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  message = "This action cannot be undone.",
  confirmLabel = "Confirm",
  tone = "danger",
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }>
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}
