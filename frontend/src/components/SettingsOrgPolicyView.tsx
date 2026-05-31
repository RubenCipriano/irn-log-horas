"use client";

import { useEffect, useState } from "react";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useOrgPolicy, useUpdateOrgPolicy } from "@/hooks/useOrgPolicy";
import { SettingsNav } from "@/components/SettingsNav";

// Org policy editor — schedule + holiday profile.
//
// Both fields are stored as opaque JSON strings on the backend; this
// view parses on load, edits via typed forms, then re-serialises on
// save. Null means "use the built-in PT-IRN default" — we surface a
// "Reset to default" button per section.
//
// Scope: edits the fallback weekday-hours + the holiday preset key +
// the additions/exclusions lists. Periods (windowed schedule overrides
// like "Summer") aren't in this first cut — they're an advanced feature
// (rare in real orgs) and adding them well needs a date-range picker
// per row that's more UI than I want to bake in here. Easy to follow.

type WeekdayHours = {
  mon: number; tue: number; wed: number; thu: number;
  fri: number; sat: number; sun: number;
};

type OrgScheduleConfig = { fallback: WeekdayHours; periods?: unknown[] };
type OrgHolidayProfile = {
  preset?: string | null;
  additions?: { name: string; month: number; day: number }[];
  exclusions?: { name: string; region: string }[];
};

const DEFAULT_HOURS: WeekdayHours = { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };
const HOLIDAY_PRESETS = ["portugal", "spain", "united-kingdom", "united-states", "brazil"];

export function SettingsOrgPolicyView() {
  const { orgId } = useCurrentOrgId();
  const policy = useOrgPolicy(orgId);
  const update = useUpdateOrgPolicy(orgId);

  const [hours, setHours] = useState<WeekdayHours>(DEFAULT_HOURS);
  const [preset, setPreset] = useState<string>("");
  const [additions, setAdditions] = useState<{ name: string; month: number; day: number }[]>([]);
  const [exclusions, setExclusions] = useState<{ name: string; region: string }[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Hydrate local state from the server's JSON strings once.
  useEffect(() => {
    if (!policy.data) return;
    if (policy.data.scheduleConfig) {
      try {
        const parsed = JSON.parse(policy.data.scheduleConfig) as OrgScheduleConfig;
        setHours({ ...DEFAULT_HOURS, ...parsed.fallback });
      } catch { /* leave defaults */ }
    }
    if (policy.data.holidayProfile) {
      try {
        const parsed = JSON.parse(policy.data.holidayProfile) as OrgHolidayProfile;
        setPreset(parsed.preset ?? "");
        setAdditions(parsed.additions ?? []);
        setExclusions(parsed.exclusions ?? []);
      } catch { /* leave empties */ }
    }
  }, [policy.data]);

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">Pick an org first.</div>;

  async function onSaveAll(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(false);
    try {
      const scheduleConfig: OrgScheduleConfig = { fallback: hours, periods: [] };
      const holidayProfile: OrgHolidayProfile = {
        preset: preset || null,
        additions,
        exclusions,
      };
      await update.mutateAsync({
        setSchedule: true,
        scheduleConfig: JSON.stringify(scheduleConfig),
        setHolidays: true,
        holidayProfile: JSON.stringify(holidayProfile),
      });
      setSaveOk(true);
    } catch {
      setSaveError("Failed to save — check the JSON validity.");
    }
  }

  async function resetSchedule() {
    if (!confirm("Reset schedule to org default?")) return;
    await update.mutateAsync({ setSchedule: true, scheduleConfig: null });
    setHours(DEFAULT_HOURS);
  }
  async function resetHolidays() {
    if (!confirm("Reset holidays to org default?")) return;
    await update.mutateAsync({ setHolidays: true, holidayProfile: null });
    setPreset(""); setAdditions([]); setExclusions([]);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <SettingsNav />
      <header className="tf-fade-up">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">Org policy</p>
        <h2 className="text-xl font-semibold text-(--color-fg) mt-1">Schedule + holidays</h2>
        <p className="text-xs text-(--color-muted) mt-1">
          Drives the calendar&apos;s expected-hours per day + holiday badges.
          Leaving fields blank falls back to the built-in PT-IRN defaults.
        </p>
      </header>

      <form onSubmit={onSaveAll} className="space-y-6">
        <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3 tf-fade-up">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-(--color-fg)">Weekly schedule (fallback)</h3>
            <button type="button" onClick={resetSchedule} className={btnGhost()}>Reset to default</button>
          </header>
          <p className="text-xs text-(--color-muted)">Hours expected per weekday.</p>
          <div className="grid grid-cols-7 gap-2">
            {(["mon","tue","wed","thu","fri","sat","sun"] as const).map((k) => (
              <label key={k} className="space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-(--color-muted)">{k}</span>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  max="24"
                  value={hours[k]}
                  onChange={(e) => setHours({ ...hours, [k]: parseFloat(e.target.value) || 0 })}
                  className={inputCls()}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3 tf-fade-up">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-(--color-fg)">Holidays</h3>
            <button type="button" onClick={resetHolidays} className={btnGhost()}>Reset to default</button>
          </header>
          <label className="block space-y-1 max-w-xs">
            <span className="text-xs font-medium text-(--color-fg)">Regional preset</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)} className={inputCls()}>
              <option value="">— none (additions only) —</option>
              {HOLIDAY_PRESETS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-(--color-fg)">Additions (extra org-specific holidays)</h4>
            {additions.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={a.name}
                  onChange={(e) => {
                    const next = [...additions]; next[i] = { ...a, name: e.target.value };
                    setAdditions(next);
                  }}
                  placeholder="Name"
                  className={inputCls() + " flex-1"}
                />
                <input
                  type="number"
                  min="1" max="12"
                  value={a.month}
                  onChange={(e) => {
                    const next = [...additions]; next[i] = { ...a, month: parseInt(e.target.value) || 1 };
                    setAdditions(next);
                  }}
                  placeholder="MM"
                  className={inputCls() + " w-16"}
                />
                <input
                  type="number"
                  min="1" max="31"
                  value={a.day}
                  onChange={(e) => {
                    const next = [...additions]; next[i] = { ...a, day: parseInt(e.target.value) || 1 };
                    setAdditions(next);
                  }}
                  placeholder="DD"
                  className={inputCls() + " w-16"}
                />
                <button
                  type="button"
                  onClick={() => setAdditions(additions.filter((_, j) => j !== i))}
                  className="text-rose-500 hover:text-rose-700 text-xs"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setAdditions([...additions, { name: "", month: 1, day: 1 }])}
              className={btnGhost()}
            >
              + Add holiday
            </button>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-(--color-fg)">Exclusions (preset holidays to skip)</h4>
            {exclusions.map((x, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={x.name}
                  onChange={(e) => {
                    const next = [...exclusions]; next[i] = { ...x, name: e.target.value };
                    setExclusions(next);
                  }}
                  placeholder="Name (matches preset)"
                  className={inputCls() + " flex-1"}
                />
                <input
                  value={x.region}
                  onChange={(e) => {
                    const next = [...exclusions]; next[i] = { ...x, region: e.target.value };
                    setExclusions(next);
                  }}
                  placeholder="Region (matches preset)"
                  className={inputCls() + " flex-1"}
                />
                <button
                  type="button"
                  onClick={() => setExclusions(exclusions.filter((_, j) => j !== i))}
                  className="text-rose-500 hover:text-rose-700 text-xs"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setExclusions([...exclusions, { name: "", region: "" }])}
              className={btnGhost()}
            >
              + Add exclusion
            </button>
          </div>
        </section>

        {saveError && (
          <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-3 py-2">
            {saveError}
          </p>
        )}
        {saveOk && (
          <p className="text-xs text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 rounded px-3 py-2">
            Saved. The calendar will reflect new expected-hours within seconds.
          </p>
        )}

        <button type="submit" disabled={update.isPending} className={btnPrimary()}>
          {update.isPending ? "Saving…" : "Save policy"}
        </button>
      </form>
    </div>
  );
}

function inputCls() {
  return "w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50";
}
function btnPrimary() {
  return "rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors";
}
function btnGhost() {
  return "text-xs text-(--color-muted) hover:text-(--color-fg) px-2 py-1 rounded-md border border-(--color-border) hover:border-indigo-300 transition-colors";
}
