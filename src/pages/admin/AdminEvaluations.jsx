// src/pages/admin/AdminEvaluations.jsx
import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import Pagination from "@/components/ui/Pagination";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import ErrorAlert from "@/components/ui/ErrorAlert";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { evaluationService } from "@/services/evaluationService";

import { EVALUATION_CRITERIA, EVALUATION_RECOMMENDATIONS, PAGE_SIZE } from "@/lib/constants";
import { formatDate } from "@/utils/format";

const REC_LABEL = Object.fromEntries(EVALUATION_RECOMMENDATIONS.map((r) => [r.value, r.label]));

export default function AdminEvaluations() {

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const debouncedSearch = useDebouncedValue(search, 400);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Server-side search: correct results across all pages with exact counts.
      const res = await evaluationService.list({ page, search: debouncedSearch });
      setRows(res.data ?? []);
      setTotal(res.count ?? 0);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      key: "intern",
      header: "Intern",
      render: (r) => (
        <button onClick={() => setDetail(r)} className="text-left font-medium text-slate-800 hover:text-brand-700">
          {r.intern?.full_name || "Unknown intern"}
        </button>
      ),
    },
    { key: "overall", header: "Overall", render: (r) => `${r.overall_rating ?? "—"}/5` },
    {
      key: "recommendation",
      header: "Recommendation",
      render: (r) => <Badge tone="brand">{REC_LABEL[r.final_recommendation] ?? r.final_recommendation ?? "—"}</Badge>,
    },
    { key: "date", header: "Date", render: (r) => formatDate(r.created_at) },
  ];

  return (
    <div>
      <PageHeader title="Evaluations" description="All supervisor evaluations across interns." />
      <Card>
        <div className="border-b border-brand-100 p-4">
          <Input
            placeholder="Search intern name…"
            aria-label="Search evaluations by intern name"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-xs"
          />
        </div>
        {loading ? (
          <Spinner label="Loading evaluations…" />
        ) : loadError ? (
          <div className="p-5">
            <ErrorAlert message={loadError.message} onRetry={load} loading={loading} />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className="p-4 text-center text-sm text-slate-500">
                {debouncedSearch
                  ? "No evaluations match your search."
                  : "No evaluations yet."}
              </div>
            }
          />
        )}
        {total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        )}
      </Card>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Evaluation Details" size="md">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-800">{detail.intern?.full_name || "Unknown intern"}</p>
              <Badge tone="brand">{REC_LABEL[detail.final_recommendation] ?? detail.final_recommendation}</Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {EVALUATION_CRITERIA.map((c) => (
                <div key={c.key} className="flex items-center justify-between rounded-lg bg-brand-50/50 px-3 py-2 text-sm">
                  <span className="text-slate-600">{c.label}</span>
                  <span className="font-semibold text-slate-800">{detail[c.key] ?? "—"}/5</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Overall: </span>
              <span className="font-semibold text-brand-700">{detail.overall_rating ?? "—"}/5</span>
            </div>
            {detail.comments && (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-700">Comments</p>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{detail.comments}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
