"use client";

import { useMemo, useState } from "react";
import { downloadWorklogsCsv } from "@/lib/csv-download";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useProjects } from "@/hooks/useProjects";
import { useExpectedHours, useWorklogs } from "@/hooks/useWorklogs";

// Reports — date-range summary + CSV download.
//
// Shows: total logged in range, total expected, per-project breakdown,
// and a "Download CSV" button that hits the GET /worklogs/export.csv
// endpoint with the same range. Defaults to "this month" but the user
// can pick anything up to 5 years (the backend cap).
export function ReportsView() {
  const { orgId } = useCurrentOrgId();
  const [from, setFrom] = useState(() => startOfMonthIso());
  const [to, setTo] = useState(() => endOfMonthIso());

  const projects = useProjects(orgId, true);
  const worklogs = useWorklogs(orgId, from, to);
  const expected = useExpectedHours(orgId, from, to);

  const byProject = useMemo(() => {
    // Worklog.projectId is now nullable (upstream worklogs leave it null
    // and use upstreamTaskId instead). Group those under a separate
    // "Upstream" bucket so the report still totals correctly.
    const map = new Map<string, number>();
    for (const w of worklogs.data ?? []) {
      const key = w.projectId ?? "__upstream__";
      map.set(key, (map.get(key) ?? 0) + w.hours);
    }
    return Array.from(map.entries())
      .map(([projectId, hours]) => {
        if (projectId === "__upstream__") {
          return { projectId, hours, name: "Upstream-tracked", code: null as string | null };
        }
        const proj = projects.data?.find((p) => p.id === projectId);
        return { projectId, hours, name: proj?.name ?? "(deleted project)", code: proj?.code ?? null };
      })
      .sort((a, b) => b.hours - a.hours);
  }, [worklogs.data, projects.data]);

  const totalLogged = (worklogs.data ?? []).reduce((acc, w) => acc + w.hours, 0);
  const totalExpected = expected.data?.total ?? 0;

  async function downloadCsv() {
    if (!orgId) return;
    await downloadWorklogsCsv({
      orgId,
      from,
      to,
      filename: `worklogs-${from}-${to}.csv`,
    });
  }

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">Pick an org first.</div>;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <header className="space-y-1 tf-fade-up">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">Reports</p>
        <h2 className="text-2xl font-bold text-(--color-fg)">Time summary</h2>
      </header>

      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 tf-fade-up">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputCls()}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputCls()}
            />
          </label>
          <div className="flex gap-2 ml-auto">
            <button onClick={() => quickRange(setFrom, setTo, "month")} className={btnGhost()}>This month</button>
            <button onClick={() => quickRange(setFrom, setTo, "year")} className={btnGhost()}>This year</button>
            <button onClick={downloadCsv} className={btnPrimary()}>
              Download CSV
            </button>
          </div>
        </div>
      </section>

      <section className="grid sm:grid-cols-3 gap-3 tf-fade-up">
        <StatCard label="Logged" value={`${totalLogged.toFixed(1)}h`} />
        <StatCard label="Expected" value={`${totalExpected.toFixed(1)}h`} />
        <StatCard
          label={totalLogged >= totalExpected ? "Surplus" : "Deficit"}
          value={`${Math.abs(totalLogged - totalExpected).toFixed(1)}h`}
          tone={totalLogged >= totalExpected ? "ok" : "warn"}
        />
      </section>

      <section className="space-y-2 tf-fade-up">
        <h3 className="text-sm font-semibold text-(--color-fg)">By project</h3>
        {worklogs.isLoading && <p className="text-sm text-(--color-muted)">Loading…</p>}
        {!worklogs.isLoading && byProject.length === 0 && (
          <p className="text-sm text-(--color-muted)">No worklogs in this range.</p>
        )}
        {byProject.length > 0 && (
          <ul className="space-y-1">
            {byProject.map((row) => {
              const pct = totalLogged > 0 ? (row.hours / totalLogged) * 100 : 0;
              return (
                <li
                  key={row.projectId}
                  className="rounded-lg border border-(--color-border) bg-(--color-card) p-3"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-(--color-fg) font-medium">
                      {row.name}{" "}
                      {row.code && <span className="text-(--color-muted) text-xs">({row.code})</span>}
                    </span>
                    <span className="text-(--color-fg) font-mono tabular-nums">{row.hours.toFixed(1)}h</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-(--color-bg) rounded-full overflow-hidden">
                    <div
                      className="h-full bg-linear-to-r from-indigo-500 to-violet-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const valueTone =
    tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
    : "text-(--color-fg)";
  return (
    <div className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5">
      <p className="text-xs font-medium text-(--color-muted) uppercase tracking-wider">{label}</p>
      <p className={"text-3xl font-bold mt-1 " + valueTone}>{value}</p>
    </div>
  );
}

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function endOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function quickRange(setFrom: (s: string) => void, setTo: (s: string) => void, kind: "month" | "year") {
  const now = new Date();
  if (kind === "month") {
    setFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
    setTo(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
  } else {
    setFrom(`${now.getFullYear()}-01-01`);
    setTo(`${now.getFullYear()}-12-31`);
  }
}
function inputCls() {
  return "rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none";
}
function btnPrimary() {
  return "rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 transition-colors";
}
function btnGhost() {
  return "text-sm text-(--color-muted) hover:text-(--color-fg) px-2 py-1 rounded-md border border-(--color-border) hover:border-indigo-300 transition-colors";
}
