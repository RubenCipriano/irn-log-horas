"use client";

import Link from "next/link";
import { useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import {
  useDeleteInvoice,
  useInvoice,
  useUpdateInvoice,
  type InvoiceLineItem,
  type LineCadence,
  type QuantityUnit,
} from "@/hooks/useInvoices";
import { StatusBadge } from "@/components/InvoicesView";
import { api } from "@/lib/api";

export function InvoiceDetailView({ invoiceId }: { invoiceId: string }) {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const invoice = useInvoice(orgId, invoiceId);
  const update = useUpdateInvoice(orgId);
  const del = useDeleteInvoice(orgId);
  const [error, setError] = useState<string | null>(null);

  async function transition(status: string) {
    setError(null);
    try {
      await update.mutateAsync({ invoiceId, body: { status } });
    } catch (err) {
      setError(axiosErr(err) ?? "Action failed.");
    }
  }

  async function onDelete() {
    setError(null);
    if (!confirm("Delete this draft invoice? Worklogs go back to unbilled.")) return;
    try {
      await del.mutateAsync(invoiceId);
      window.location.href = "/invoices";
    } catch (err) {
      setError(axiosErr(err) ?? "Delete failed.");
    }
  }

  async function downloadPdf() {
    try {
      // Use api so cookies travel with the request, then assemble a Blob URL.
      const resp = await api.get(`/api/orgs/${orgId}/invoices/${invoiceId}/pdf`, { responseType: "blob" });
      const blob = new Blob([resp.data as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.data?.number ?? "invoice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(axiosErr(err) ?? "PDF failed.");
    }
  }

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">Pick an org first.</div>;
  if (invoice.isLoading) return <div className="p-6 text-sm text-(--color-muted)">Loading…</div>;
  if (!invoice.data) return (
    <div className="p-6 max-w-5xl mx-auto space-y-3">
      <p className="text-sm text-(--color-muted)">Invoice not found.</p>
      <Link href="/invoices" className="text-xs text-indigo-600 hover:underline">← Back to invoices</Link>
    </div>
  );

  const inv = invoice.data;
  const canEdit = inv.status === "draft";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link href="/invoices" className="text-xs text-indigo-600 hover:underline">← Invoices</Link>

      <header className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-(--color-fg)">{inv.number}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="text-sm text-(--color-muted) mt-1">
            <Link href={`/projects/${inv.projectId}`} className="hover:underline">{inv.projectName}</Link>
            {" · "}
            {inv.periodFrom} → {inv.periodTo}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={downloadPdf} className="text-xs rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg)">
            PDF
          </button>
          {inv.status === "draft" && (
            <button onClick={() => transition("sent")} disabled={update.isPending} className="text-xs rounded-md bg-indigo-600 text-white px-2 py-1 hover:bg-indigo-700 disabled:opacity-50">
              Send
            </button>
          )}
          {inv.status === "sent" && (
            <button onClick={() => transition("paid")} disabled={update.isPending} className="text-xs rounded-md bg-emerald-600 text-white px-2 py-1 hover:bg-emerald-700 disabled:opacity-50">
              Mark paid
            </button>
          )}
          {inv.status !== "void" && (
            <button onClick={() => transition("void")} disabled={update.isPending} className="text-xs rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg)">
              Void
            </button>
          )}
          {canEdit && (
            <button onClick={onDelete} disabled={del.isPending} className="text-xs text-rose-500 hover:text-rose-700 px-2 py-1 disabled:opacity-50">
              Delete
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">{error}</p>
      )}

      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
        <h2 className="text-sm font-semibold text-(--color-fg)">Lines</h2>
        <InvoiceLinesTable lines={inv.lines} t={t} />

        <div className="flex justify-end">
          <div className="w-64 text-sm space-y-1">
            <div className="flex justify-between text-(--color-muted)"><span>Subtotal</span><span className="font-mono">{inv.subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-(--color-muted)"><span>Tax ({inv.taxPct.toFixed(2)}%)</span><span className="font-mono">{inv.taxAmount.toFixed(2)}</span></div>
            <div className="flex justify-between font-semibold text-(--color-fg) border-t border-(--color-border) pt-1">
              <span>Total</span><span className="font-mono">{inv.total.toFixed(2)} {inv.currency}</span>
            </div>
          </div>
        </div>
      </section>

      {inv.notes && (
        <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-2">
          <h3 className="text-sm font-semibold text-(--color-fg)">Notes</h3>
          <p className="text-sm text-(--color-fg) whitespace-pre-wrap">{inv.notes}</p>
        </section>
      )}
    </div>
  );
}

function axiosErr(err: unknown): string | null {
  if (axios.isAxiosError(err) && err.response?.data?.error) return String(err.response.data.error);
  return null;
}

// Cadence-aware lines table. Legacy invoices (backfilled to
// cadence='hourly', quantityUnit='hours') still render identically to
// the pre-cadence layout, so we hide the Unit column when there's no
// non-hour row.
function InvoiceLinesTable({
  lines,
  t,
}: {
  lines: InvoiceLineItem[];
  t: (key: string) => string;
}) {
  const hasNonHourUnit = lines.some((l) => l.quantityUnit !== "hours");
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-(--color-muted) text-left">
        <tr>
          <th className="font-medium pb-2">
            {t("invoice.generate.colDescription")}
          </th>
          <th className="font-medium pb-2 text-right">
            {t("invoice.cadence.colQuantity")}
          </th>
          {hasNonHourUnit && (
            <th className="font-medium pb-2 text-right">
              {t("invoice.cadence.colUnit")}
            </th>
          )}
          <th className="font-medium pb-2 text-right">
            {t("invoice.generate.colRate")}
          </th>
          <th className="font-medium pb-2 text-right">
            {t("invoice.generate.colAmount")}
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="border-t border-(--color-border)">
            <td className="py-1.5">
              <span className="flex items-center gap-2">
                <CadenceBadge cadence={l.cadence} t={t} />
                <span>{l.description}</span>
              </span>
            </td>
            <td className="py-1.5 text-right font-mono">
              {formatQuantity(l.quantity, l.quantityUnit)}
            </td>
            {hasNonHourUnit && (
              <td className="py-1.5 text-right text-xs text-(--color-muted)">
                {t(`invoice.cadence.unit.${l.quantityUnit}`)}
              </td>
            )}
            <td className="py-1.5 text-right font-mono text-(--color-muted)">
              {l.billRate.toFixed(2)}
            </td>
            <td className="py-1.5 text-right font-mono">
              {l.amount.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CadenceBadge({
  cadence,
  t,
}: {
  cadence: LineCadence;
  t: (key: string) => string;
}) {
  const tone =
    cadence === "monthly"
      ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
      : cadence === "daily"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        : "bg-(--color-bg) text-(--color-muted)";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {t(`invoice.cadence.${cadence}`)}
    </span>
  );
}

function formatQuantity(q: number, unit: QuantityUnit): string {
  if (unit === "months") return q.toFixed(4);
  return q.toFixed(2);
}
