"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useMembers } from "@/hooks/useMembers";
import { useProjects } from "@/hooks/useProjects";
import {
  useGenerateInvoice,
  useGenerateInvoiceFromMember,
  usePreviewInvoice,
  usePreviewInvoiceForMember,
  type LineCadence,
  type MemberPreviewResponse,
  type PreviewLine,
  type PreviewResponse,
  type QuantityUnit,
} from "@/hooks/useInvoices";

type Target = "project" | "member";

// Wizard for both project- and member-targeted invoices. The target
// picker at the top swaps the form below; preview/generate hit different
// endpoints per target. Deep links from MemberDetailView pre-fill the
// member tab via ?target=member&userId=... read from the URL on mount.
export function InvoiceGenerateView() {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const projects = useProjects(orgId, false);
  const members = useMembers(orgId);

  const previewProject = usePreviewInvoice(orgId);
  const generateProject = useGenerateInvoice(orgId);
  const previewMember = usePreviewInvoiceForMember(orgId);
  const generateMember = useGenerateInvoiceFromMember(orgId);

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [target, setTarget] = useState<Target>("project");

  // Shared form state — both target modes use the same period/tax/notes
  // shape so toggling tabs keeps the typed values.
  const [periodFrom, setPeriodFrom] = useState(toIso(monthStart));
  const [periodTo, setPeriodTo] = useState(toIso(monthEnd));
  const [taxPct, setTaxPct] = useState("0");
  const [notes, setNotes] = useState("");

  // Project-target state.
  const [projectId, setProjectId] = useState("");
  const [projectPreviewData, setProjectPreviewData] =
    useState<PreviewResponse | null>(null);

  // Member-target state.
  const [memberUserId, setMemberUserId] = useState("");
  const [memberProjectFilter, setMemberProjectFilter] = useState(""); // "" = all
  const [memberClientId, setMemberClientId] = useState("");
  const [memberPreviewData, setMemberPreviewData] =
    useState<MemberPreviewResponse | null>(null);

  const [error, setError] = useState<string | null>(null);

  // URL-driven deep link: /invoices/new?target=member&userId=...
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("target");
    if (t === "member") setTarget("member");
    const uid = params.get("userId");
    if (uid) setMemberUserId(uid);
    const pid = params.get("projectId");
    if (pid && t === "member") setMemberProjectFilter(pid);
  }, []);

  function resetPreviews() {
    setProjectPreviewData(null);
    setMemberPreviewData(null);
    setError(null);
  }

  function switchTarget(next: Target) {
    if (next === target) return;
    setTarget(next);
    resetPreviews();
  }

  async function onProjectPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProjectPreviewData(null);
    if (!projectId) return;
    try {
      const data = await previewProject.mutateAsync({
        projectId,
        periodFrom,
        periodTo,
        taxPct: Number(taxPct) || 0,
        notes: notes.trim() || undefined,
      });
      setProjectPreviewData(data);
    } catch (err) {
      setError(axiosErr(err) ?? t("invoice.generate.previewFailed"));
    }
  }

  async function onProjectGenerate() {
    setError(null);
    try {
      const created = await generateProject.mutateAsync({
        projectId,
        periodFrom,
        periodTo,
        taxPct: Number(taxPct) || 0,
        notes: notes.trim() || undefined,
      });
      window.location.href = `/invoices/${created.id}`;
    } catch (err) {
      setError(axiosErr(err) ?? t("invoice.generate.createFailed"));
    }
  }

  async function onMemberPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMemberPreviewData(null);
    if (!memberUserId) return;
    try {
      const data = await previewMember.mutateAsync({
        userId: memberUserId,
        periodFrom,
        periodTo,
        projectId: memberProjectFilter || undefined,
        clientId: memberClientId || undefined,
        taxPct: Number(taxPct) || 0,
        notes: notes.trim() || undefined,
      });
      setMemberPreviewData(data);
      // If the server settled the ambiguity (only one candidate client),
      // auto-pin it so the generate button is enabled without further
      // input.
      if (!data.multipleClients && data.candidateClientIds.length === 1) {
        setMemberClientId(data.candidateClientIds[0]);
      }
    } catch (err) {
      setError(axiosErr(err) ?? t("invoice.generate.previewFailed"));
    }
  }

  async function onMemberGenerate() {
    setError(null);
    try {
      const created = await generateMember.mutateAsync({
        userId: memberUserId,
        periodFrom,
        periodTo,
        projectId: memberProjectFilter || undefined,
        clientId: memberClientId || undefined,
        taxPct: Number(taxPct) || 0,
        notes: notes.trim() || undefined,
      });
      window.location.href = `/invoices/${created.id}`;
    } catch (err) {
      // Defence-in-depth: handle a 409 spans-clients echo if the preview
      // state desynced from what /from-member sees on the server.
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const body = err.response.data as
          | { error?: string; clientIds?: string[] }
          | undefined;
        if (body?.error === "MEMBER_SPANS_CLIENTS" && body.clientIds?.length) {
          setMemberPreviewData((prev) =>
            prev
              ? {
                  ...prev,
                  multipleClients: true,
                  candidateClientIds: body.clientIds!,
                }
              : prev,
          );
          setError(t("invoice.member.spansClients"));
          return;
        }
      }
      setError(axiosErr(err) ?? t("invoice.generate.createFailed"));
    }
  }

  if (!orgId)
    return (
      <div className="p-6 text-sm text-(--color-muted)">
        {t("common.pickOrgFirst")}
      </div>
    );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link
        href="/invoices"
        className="text-xs text-indigo-600 hover:underline"
      >
        ← {t("invoices.title")}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-(--color-fg)">
          {t("invoice.generate.title")}
        </h1>
        <p className="text-sm text-(--color-muted)">
          {t("invoice.generate.subtitle")}
        </p>
      </header>

      <TargetPicker target={target} onChange={switchTarget} t={t} />

      {target === "project" ? (
        <form
          onSubmit={onProjectPreview}
          className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 grid grid-cols-2 gap-3"
        >
          <label className="col-span-2 space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">
              {t("invoice.generate.project")}
            </span>
            <select
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={inputCls()}
            >
              <option value="">{t("invoice.generate.pickProject")}</option>
              {(projects.data ?? [])
                .filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <PeriodFields
            periodFrom={periodFrom}
            periodTo={periodTo}
            taxPct={taxPct}
            notes={notes}
            setPeriodFrom={setPeriodFrom}
            setPeriodTo={setPeriodTo}
            setTaxPct={setTaxPct}
            setNotes={setNotes}
            t={t}
          />
          {error && (
            <p className="col-span-2 text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
              {error}
            </p>
          )}
          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={previewProject.isPending || !projectId}
              className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {previewProject.isPending
                ? t("invoice.generate.previewing")
                : t("invoice.generate.preview")}
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={onMemberPreview}
          className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 grid grid-cols-2 gap-3"
        >
          <label className="col-span-2 space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">
              {t("invoice.member.pickMember")}
            </span>
            <select
              required
              value={memberUserId}
              onChange={(e) => {
                setMemberUserId(e.target.value);
                setMemberClientId("");
                setMemberPreviewData(null);
              }}
              className={inputCls()}
            >
              <option value="">{t("invoice.member.pickMember")}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">
              {t("invoice.member.projectFilter")}
            </span>
            <select
              value={memberProjectFilter}
              onChange={(e) => {
                setMemberProjectFilter(e.target.value);
                setMemberClientId("");
                setMemberPreviewData(null);
              }}
              className={inputCls()}
            >
              <option value="">{t("invoice.member.allProjects")}</option>
              {(projects.data ?? [])
                .filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <PeriodFields
            periodFrom={periodFrom}
            periodTo={periodTo}
            taxPct={taxPct}
            notes={notes}
            setPeriodFrom={setPeriodFrom}
            setPeriodTo={setPeriodTo}
            setTaxPct={setTaxPct}
            setNotes={setNotes}
            t={t}
          />
          {error && (
            <p className="col-span-2 text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
              {error}
            </p>
          )}
          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={previewMember.isPending || !memberUserId}
              className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {previewMember.isPending
                ? t("invoice.generate.previewing")
                : t("invoice.generate.preview")}
            </button>
          </div>
        </form>
      )}

      {target === "project" && projectPreviewData && (
        <PreviewPanel
          data={projectPreviewData}
          target="project"
          onGenerate={onProjectGenerate}
          generatePending={generateProject.isPending}
          t={t}
        />
      )}

      {target === "member" && memberPreviewData && (
        <MemberPreviewPanel
          data={memberPreviewData}
          clientId={memberClientId}
          onClientChange={(v) => {
            setMemberClientId(v);
            setError(null);
          }}
          onRePreview={() => {
            // Re-running the preview after a client pick lets the server
            // confirm the now-disambiguated payload. Cheap and keeps the
            // banner accurate.
            void onMemberPreview({ preventDefault() {} } as React.FormEvent);
          }}
          onGenerate={onMemberGenerate}
          generatePending={generateMember.isPending}
          t={t}
        />
      )}
    </div>
  );
}

function TargetPicker({
  target,
  onChange,
  t,
}: {
  target: Target;
  onChange: (next: Target) => void;
  t: (key: string) => string;
}) {
  const btn = (k: Target, label: string) => (
    <button
      type="button"
      onClick={() => onChange(k)}
      className={[
        "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
        target === k
          ? "bg-indigo-600 text-white"
          : "bg-(--color-bg) text-(--color-muted) hover:text-(--color-fg)",
      ].join(" ")}
      aria-pressed={target === k}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex gap-1 rounded-lg border border-(--color-border) bg-(--color-card) p-1">
      {btn("project", t("invoice.target.project"))}
      {btn("member", t("invoice.target.member"))}
    </div>
  );
}

function PeriodFields({
  periodFrom,
  periodTo,
  taxPct,
  notes,
  setPeriodFrom,
  setPeriodTo,
  setTaxPct,
  setNotes,
  t,
}: {
  periodFrom: string;
  periodTo: string;
  taxPct: string;
  notes: string;
  setPeriodFrom: (v: string) => void;
  setPeriodTo: (v: string) => void;
  setTaxPct: (v: string) => void;
  setNotes: (v: string) => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <label className="space-y-1">
        <span className="text-xs font-medium text-(--color-fg)">
          {t("invoice.generate.from")}
        </span>
        <input
          type="date"
          required
          value={periodFrom}
          onChange={(e) => setPeriodFrom(e.target.value)}
          className={inputCls()}
        />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-(--color-fg)">
          {t("invoice.generate.to")}
        </span>
        <input
          type="date"
          required
          value={periodTo}
          onChange={(e) => setPeriodTo(e.target.value)}
          className={inputCls()}
        />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-(--color-fg)">
          {t("invoice.generate.taxPct")}
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={taxPct}
          onChange={(e) => setTaxPct(e.target.value)}
          className={inputCls()}
        />
      </label>
      <label className="col-span-2 space-y-1">
        <span className="text-xs font-medium text-(--color-fg)">
          {t("invoice.generate.notes")}
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputCls()}
        />
      </label>
    </>
  );
}

function PreviewPanel({
  data,
  target,
  onGenerate,
  generatePending,
  t,
}: {
  data: PreviewResponse;
  target: Target;
  onGenerate: () => void;
  generatePending: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-(--color-fg)">
            {t("invoice.generate.previewTitle", { name: data.billedPartyName })}
          </h2>
          <p className="text-xs text-(--color-muted)">
            {t("invoice.generate.previewLines", {
              count: data.lines.length,
              currency: data.currency,
            })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-(--color-muted)">
            {t("invoice.generate.subtotal", {
              value: data.subtotal.toFixed(2),
              tax: data.taxAmount.toFixed(2),
            })}
          </p>
          <p className="text-sm font-semibold text-(--color-fg)">
            {t("invoice.generate.total", {
              value: data.total.toFixed(2),
              currency: data.currency,
            })}
          </p>
        </div>
      </header>

      {data.warnings.length > 0 && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs px-3 py-2">
          <p className="font-medium">{t("invoice.generate.warnings")}</p>
          <ul className="list-disc list-inside">
            {data.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {data.lines.length === 0 ? (
        <p className="text-xs text-(--color-muted)">
          {t("invoice.generate.noBillables")}
        </p>
      ) : (
        <PreviewLinesTable lines={data.lines} t={t} />
      )}

      {data.lines.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onGenerate}
            disabled={generatePending}
            className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {generatePending
              ? t("invoice.generate.creating")
              : target === "member"
                ? t("invoice.member.createCta")
                : t("invoice.generate.create")}
          </button>
        </div>
      )}
    </section>
  );
}

function MemberPreviewPanel({
  data,
  clientId,
  onClientChange,
  onRePreview,
  onGenerate,
  generatePending,
  t,
}: {
  data: MemberPreviewResponse;
  clientId: string;
  onClientChange: (v: string) => void;
  onRePreview: () => void;
  onGenerate: () => void;
  generatePending: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  // Disambiguation gate: a multi-client member must pin a client before
  // /from-member is allowed. We surface the picker inline (radios) and
  // keep the Generate button disabled until a choice is made.
  const needsClientPick =
    data.multipleClients && data.candidateClientIds.length > 1;
  const canGenerate =
    data.lines.length > 0 && (!needsClientPick || !!clientId);
  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-(--color-fg)">
            {t("invoice.member.previewTitle", { name: data.memberName })}
          </h2>
          <p className="text-xs text-(--color-muted)">
            {t("invoice.generate.previewLines", {
              count: data.lines.length,
              currency: data.currency,
            })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-(--color-muted)">
            {t("invoice.generate.subtotal", {
              value: data.subtotal.toFixed(2),
              tax: data.taxAmount.toFixed(2),
            })}
          </p>
          <p className="text-sm font-semibold text-(--color-fg)">
            {t("invoice.generate.total", {
              value: data.total.toFixed(2),
              currency: data.currency,
            })}
          </p>
        </div>
      </header>

      {data.warnings.length > 0 && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs px-3 py-2">
          <p className="font-medium">{t("invoice.generate.warnings")}</p>
          <ul className="list-disc list-inside">
            {data.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {needsClientPick && (
        <ClientPicker
          clientIds={data.candidateClientIds}
          candidateClients={data.candidateClients}
          selected={clientId}
          onSelect={onClientChange}
          onConfirm={onRePreview}
          t={t}
        />
      )}

      {data.lines.length === 0 ? (
        <p className="text-xs text-(--color-muted)">
          {t("invoice.generate.noBillables")}
        </p>
      ) : (
        <PreviewLinesTable lines={data.lines} t={t} />
      )}

      {data.lines.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onGenerate}
            disabled={generatePending || !canGenerate}
            className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {generatePending
              ? t("invoice.generate.creating")
              : t("invoice.member.createCta")}
          </button>
        </div>
      )}
    </section>
  );
}

function ClientPicker({
  clientIds,
  candidateClients,
  selected,
  onSelect,
  onConfirm,
  t,
}: {
  clientIds: string[];
  candidateClients?: { id: string; name: string }[];
  selected: string;
  onSelect: (v: string) => void;
  onConfirm: () => void;
  t: (key: string) => string;
}) {
  const nameFor = (id: string) =>
    candidateClients?.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  return (
    <div className="rounded-md bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs px-3 py-2 space-y-2">
      <p className="font-medium">{t("invoice.member.spansClients")}</p>
      <fieldset className="space-y-1">
        <legend className="sr-only">{t("invoice.member.pickClient")}</legend>
        {clientIds.map((cid) => (
          <label
            key={cid}
            className="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="radio"
              name="invoice-client-pick"
              value={cid}
              checked={selected === cid}
              onChange={() => onSelect(cid)}
            />
            <span>{nameFor(cid)}</span>
          </label>
        ))}
      </fieldset>
      {selected && (
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md border border-rose-300 dark:border-rose-700 px-2 py-1 text-xs font-medium hover:bg-rose-100/50 dark:hover:bg-rose-500/20"
        >
          {t("invoice.generate.preview")}
        </button>
      )}
    </div>
  );
}

function PreviewLinesTable({
  lines,
  t,
}: {
  lines: PreviewLine[];
  t: (key: string) => string;
}) {
  // Hide the Unit column when every line is in hours. Mixed-unit member
  // invoices (rare: a single member can only have ONE cadence in
  // practice) get the full Unit column; legacy hourly-only invoices stay
  // as terse as before.
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
        {lines.map((l, idx) => (
          <tr key={idx} className="border-t border-(--color-border)">
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

// `months` shows 4 decimals because the value is a [0,1] pro-ration; the
// other units stay at 2 to match the rest of the table.
function formatQuantity(q: number, unit: QuantityUnit): string {
  if (unit === "months") return q.toFixed(4);
  return q.toFixed(2);
}

function inputCls() {
  return "w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50";
}

function axiosErr(err: unknown): string | null {
  if (axios.isAxiosError(err) && err.response?.data?.error)
    return String(err.response.data.error);
  return null;
}

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
