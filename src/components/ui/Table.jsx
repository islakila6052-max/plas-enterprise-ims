// src/components/ui/Table.jsx
import { cn } from "@/utils/cn";

/**
 * Lightweight data table.
 * - `columns`: [{ key, header, render?, className? }]
 * - `rows`: array of row objects
 * - `rowKey`: fn(row, index) => string|number
 */
export default function Table({ columns, rows, rowKey, empty, loading }) {
  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">Loading…</div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      empty ?? (
        <div className="py-10 text-center text-sm text-slate-500">
          No records found.
        </div>
      )
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "whitespace-nowrap px-4 py-3 font-semibold",
                  (col.key === "actions" || col.header === "Actions") &&
                    "text-center",
                  col.className,
                )}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="transition hover:bg-slate-50">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-4 py-3 text-slate-700",
                    (col.key === "actions" || col.header === "Actions") &&
                      "text-center",
                    col.className,
                  )}>
                  {col.render ? col.render(row, i) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
