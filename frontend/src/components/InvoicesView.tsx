"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useInvoices } from "@/hooks/useInvoices";

export function InvoicesView() {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const take = 50;
  const invoices = useInvoices(orgId, {
    status: status || undefined,
    skip,
    take,
  });

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">{t("common.pickOrgFirst")}</div>;

  const total = invoices.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / take));
  const page = Math.floor(skip / take);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-(--color-fg)">{t("invoices.title")}</h1>
          <p className="text-sm text-(--color-muted)">{t("invoices.subtitle", { count: total, year: new Date().getFullYear() })}</p>
        </div>
        <Link
          href="/invoices/new"
          className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700"
        >
          {t("invoices.new")}
        </Link>
      </header>

      <div className="flex items-center gap-2">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setSkip(0); }}
          className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm"
        >
          <option value="">{t("invoices.status.all")}</option>
          <option value="draft">{t("invoices.status.draft")}</option>
          <option value="sent">{t("invoices.status.sent")}</option>
          <option value="paid">{t("invoices.status.paid")}</option>
          <option value="void">{t("invoices.status.void")}</option>
        </select>
      </div>

      {invoices.isLoading && <p className="text-sm text-(--color-muted)">{t("common.loading")}</p>}
      {invoices.data && invoices.data.items.length === 0 && (
        <p className="text-sm text-(--color-muted)">{t("invoices.empty")}</p>
      )}
      {invoices.data && invoices.data.items.length > 0 && (
        <ul className="rounded-md border border-(--color-border) divide-y divide-(--color-border)">
          {invoices.data.items.map((i) => (
            <li key={i.id} className="px-3 py-2 text-sm flex items-center gap-3 hover:bg-(--color-bg)">
              <Link href={`/invoices/${i.id}`} className="font-mono text-(--color-fg) hover:underline shrink-0">{i.number}</Link>
              <Link href={`/projects/${i.projectId}`} className="text-(--color-fg) hover:underline truncate flex-1 min-w-0">
                {i.projectName}
              </Link>
              <span className="text-xs text-(--color-muted)">{i.periodFrom} → {i.periodTo}</span>
              <span className="text-xs font-mono text-(--color-fg)">{i.total.toFixed(2)} {i.currency}</span>
              <StatusBadge status={i.status} />
            </li>
          ))}
        </ul>
      )}

      {total > take && (
        <div className="flex items-center justify-between text-xs text-(--color-muted)">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setSkip(Math.max(0, skip - take))}
            className="rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg) disabled:opacity-40"
          >
            {t("invoices.prev")}
          </button>
          <span>{t("invoices.page", { page: page + 1, pages })}</span>
          <button
            type="button"
            disabled={page + 1 >= pages}
            onClick={() => setSkip(skip + take)}
            className="rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg) disabled:opacity-40"
          >
            {t("invoices.next")}
          </button>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = (() => {
    switch (status) {
      case "paid": return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
      case "sent": return "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300";
      case "void": return "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
      default: return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
    }
  })();
  return (
    <span className={"rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase " + tone}>
      {status}
    </span>
  );
}
