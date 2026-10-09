// src/components/ui/Pagination.jsx
import Button from "@/components/ui/Button";

/** Simple previous/next pagination control. */
export default function Pagination({ page, pageSize, total, onPageChange }) {
  const safePageSize = Number(pageSize) > 0 ? Number(pageSize) : 10;
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Page {safePage} of {totalPages} · {Number(total) || 0} record{(Number(total) || 0) === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Previous page">
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Next page">
          Next
        </Button>
      </div>
    </div>
  );
}
