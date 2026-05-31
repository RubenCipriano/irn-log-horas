"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useHolidayCountries } from "@/hooks/useHolidayCountries";
import {
  useProjectPolicy,
  useUpdateProjectPolicy,
} from "@/hooks/useProjectPolicy";
import type { EffectivePolicyBlock } from "@/lib/types";

// Per-project policy editor. Two cards (schedule + holidays). Each
// field can be either "local" (the project sets its own value) or
// "inherited" (NULL on this row → cascade picks the value from the
// nearest ancestor that does set it, else org, else built-in default).
//
// Override flow:
//   * Field shows "Inherited from {sourceName}" when scheduleSource /
//     holidaySource / holidayCountrySource != "project".
//   * Clicking "Override" copies the inherited value into local state
//     and flips the card into edit mode.
//   * Clicking "Reset to inherited" sends Set*=true with null on save.
//
// Holiday card has two layers: a country dropdown shortcut and the
// full advanced JSON editor (preset + additions + exclusions). The
// country shortcut writes `holiday_country` and leaves `holiday_profile`
// null — the advanced editor writes the full JSON. If both are set on
// the same project row the JSON wins (matches the resolver rule).

type WeekdayHours = {
  mon: number; tue: number; wed: number; thu: number;
  fri: number; sat: number; sun: number;
};
const DEFAULT_HOURS: WeekdayHours = { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 };

type ScheduleConfig = { fallback: WeekdayHours; periods?: unknown[] };
type HolidayProfile = {
  preset?: string | null;
  additions?: { name: string; month: number; day: number }[];
  exclusions?: { name: string; region: string }[];
};

export function ProjectPolicyEditor({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const policy = useProjectPolicy(orgId, projectId);
  const update = useUpdateProjectPolicy(orgId, projectId);
  const countries = useHolidayCountries(orgId);

  // Tri-state per card: null = no local override (inherit); object = local.
  const [scheduleLocal, setScheduleLocal] = useState<WeekdayHours | null>(null);
  const [holidayCountryLocal, setHolidayCountryLocal] = useState<string | null>(null);
  const [holidayProfileLocal, setHolidayProfileLocal] = useState<HolidayProfile | null>(null);

  // Track whether the user expanded the "Advanced override" sub-section.
  // Separate from the local state so the editor can show the preset
  // values without committing them as a local override.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Hydrate from server. We parse the project's RAW columns (not the
  // effective block) — those are the actual local overrides.
  useEffect(() => {
    if (!policy.data) return;
    if (policy.data.scheduleConfig) {
      try {
        const parsed = JSON.parse(policy.data.scheduleConfig) as ScheduleConfig;
        setScheduleLocal({ ...DEFAULT_HOURS, ...parsed.fallback });
      } catch { setScheduleLocal(DEFAULT_HOURS); }
    } else {
      setScheduleLocal(null);
    }
    setHolidayCountryLocal(policy.data.holidayCountry ?? null);
    if (policy.data.holidayProfile) {
      try {
        const parsed = JSON.parse(policy.data.holidayProfile) as HolidayProfile;
        setHolidayProfileLocal({
          preset: parsed.preset ?? null,
          additions: parsed.additions ?? [],
          exclusions: parsed.exclusions ?? [],
        });
        setAdvancedOpen(true);
      } catch { setHolidayProfileLocal(null); }
    } else {
      setHolidayProfileLocal(null);
    }
  }, [policy.data]);

  // The inherited "preview" the user sees when they haven't overridden:
  // parse the effective block's JSON so we can display the actual hour
  // values + country in disabled fields.
  const effective = policy.data?.effective ?? null;
  const inheritedHours = useMemo<WeekdayHours>(() => {
    if (!effective?.scheduleConfig) return DEFAULT_HOURS;
    try {
      const parsed = JSON.parse(effective.scheduleConfig) as ScheduleConfig;
      return { ...DEFAULT_HOURS, ...parsed.fallback };
    } catch { return DEFAULT_HOURS; }
  }, [effective?.scheduleConfig]);

  const inheritedCountry = effective?.holidayCountry ?? null;

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">{t("common.pickOrgFirst")}</div>;
  if (policy.isLoading) return <div className="p-4 text-sm text-(--color-muted)">{t("common.loading")}</div>;
  if (!policy.data) return <div className="p-4 text-sm text-(--color-muted)">{t("common.notFound")}</div>;

  const scheduleIsLocal = scheduleLocal !== null;
  const holidayCountryIsLocal = holidayCountryLocal !== null;
  const holidayProfileIsLocal = holidayProfileLocal !== null;

  // For each field the displayed value is either the local override or
  // the inherited preview. Schedule + country fields are disabled until
  // the user clicks "Override".
  const displayedHours = scheduleIsLocal ? scheduleLocal! : inheritedHours;
  const displayedCountry = holidayCountryIsLocal ? holidayCountryLocal! : (inheritedCountry ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(false);

    // Build the tri-state patch. We only set a field when it changed
    // relative to the server snapshot — keeps the audit log clean.
    const snapshot = policy.data!;
    const patch: Record<string, unknown> = {};

    const snapshotHasSchedule = snapshot.scheduleConfig !== null;
    if (scheduleIsLocal) {
      patch.setSchedule = true;
      patch.scheduleConfig = JSON.stringify({ fallback: scheduleLocal!, periods: [] } satisfies ScheduleConfig);
    } else if (snapshotHasSchedule) {
      // User cleared the local override.
      patch.setSchedule = true;
      patch.scheduleConfig = null;
    }

    const snapshotHasCountry = snapshot.holidayCountry !== null;
    if (holidayCountryIsLocal) {
      patch.setHolidayCountry = true;
      patch.holidayCountry = holidayCountryLocal;
    } else if (snapshotHasCountry) {
      patch.setHolidayCountry = true;
      patch.holidayCountry = null;
    }

    const snapshotHasProfile = snapshot.holidayProfile !== null;
    if (holidayProfileIsLocal) {
      patch.setHolidays = true;
      patch.holidayProfile = JSON.stringify({
        preset: holidayProfileLocal!.preset ?? null,
        additions: holidayProfileLocal!.additions ?? [],
        exclusions: holidayProfileLocal!.exclusions ?? [],
      } satisfies HolidayProfile);
    } else if (snapshotHasProfile) {
      patch.setHolidays = true;
      patch.holidayProfile = null;
    }

    if (Object.keys(patch).length === 0) {
      setSaveOk(true);
      return;
    }

    try {
      await update.mutateAsync(patch);
      setSaveOk(true);
    } catch {
      setSaveError(t("project.policy.saveFailed"));
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <header>
        <h3 className="text-sm font-semibold text-(--color-fg)">{t("project.policy.title")}</h3>
        <p className="text-xs text-(--color-muted) mt-1">{t("project.policy.subtitle")}</p>
      </header>

      {/* ----- Weekly schedule ------------------------------------------------ */}
      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
        <header className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold text-(--color-fg)">{t("project.policy.scheduleCard.title")}</h4>
            <p className="text-xs text-(--color-muted) mt-0.5">{t("project.policy.scheduleCard.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {!scheduleIsLocal && (
              <button
                type="button"
                onClick={() => setScheduleLocal(inheritedHours)}
                className={btnGhost()}
              >
                {t("project.policy.scheduleCard.override")}
              </button>
            )}
            {scheduleIsLocal && (
              <button
                type="button"
                onClick={() => setScheduleLocal(null)}
                className={btnGhost()}
              >
                {t("project.policy.scheduleCard.clearOverride")}
              </button>
            )}
          </div>
        </header>

        {effective && (
          <InheritedBadge
            isLocal={scheduleIsLocal}
            source={effective.scheduleSource}
            sourceName={effective.scheduleSourceName}
            ancestorKey="project.policy.scheduleCard.inheritedFromAncestor"
            orgKey="project.policy.scheduleCard.inheritedFromOrg"
            defaultKey="project.policy.scheduleCard.usingDefault"
            localKey="project.policy.badge.local"
          />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(["mon", "tue", "wed", "thu", "fri"] as const).map((k) => (
            <label key={k} className="space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-(--color-muted)">
                {t(`project.policy.weekday.${k}`)}
              </span>
              <input
                type="number"
                step="0.5"
                min="0"
                max="24"
                value={displayedHours[k]}
                disabled={!scheduleIsLocal || update.isPending}
                onChange={(e) => {
                  if (!scheduleIsLocal) return;
                  const v = parseFloat(e.target.value);
                  setScheduleLocal({
                    ...scheduleLocal!,
                    [k]: Number.isFinite(v) ? v : 0,
                  });
                }}
                className={inputCls()}
              />
            </label>
          ))}
        </div>
      </section>

      {/* ----- Holidays ------------------------------------------------------- */}
      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
        <header className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold text-(--color-fg)">{t("project.policy.holidayCard.title")}</h4>
            <p className="text-xs text-(--color-muted) mt-0.5">{t("project.policy.holidayCard.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {!holidayCountryIsLocal && (
              <button
                type="button"
                onClick={() => setHolidayCountryLocal(inheritedCountry ?? "PT")}
                className={btnGhost()}
              >
                {t("project.policy.holidayCard.override")}
              </button>
            )}
            {holidayCountryIsLocal && (
              <button
                type="button"
                onClick={() => setHolidayCountryLocal(null)}
                className={btnGhost()}
              >
                {t("project.policy.holidayCard.clearOverride")}
              </button>
            )}
          </div>
        </header>

        {effective && (
          <InheritedBadge
            isLocal={holidayCountryIsLocal || holidayProfileIsLocal}
            source={effective.holidayCountrySource !== "default"
              ? effective.holidayCountrySource
              : effective.holidaySource}
            sourceName={effective.holidayCountrySource !== "default"
              ? effective.holidayCountrySourceName
              : effective.holidaySourceName}
            ancestorKey="project.policy.holidayCard.inheritedFromAncestor"
            orgKey="project.policy.holidayCard.inheritedFromOrg"
            defaultKey="project.policy.holidayCard.usingDefault"
            localKey="project.policy.badge.local"
          />
        )}

        <label className="block space-y-1 max-w-xs">
          <span className="text-xs font-medium text-(--color-fg)">
            {t("project.policy.holidayCard.country.label")}
          </span>
          <select
            value={displayedCountry}
            disabled={!holidayCountryIsLocal || update.isPending}
            onChange={(e) => {
              if (!holidayCountryIsLocal) return;
              setHolidayCountryLocal(e.target.value || null);
            }}
            className={inputCls()}
          >
            <option value="">{t("project.policy.holidayCard.country.placeholder")}</option>
            {(countries.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {t(`project.policy.holidayCard.country.${c.code}`, { defaultValue: c.displayName })}
              </option>
            ))}
          </select>
        </label>

        <div className="pt-2 border-t border-(--color-border) space-y-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs text-indigo-600 hover:text-indigo-700"
          >
            {advancedOpen ? "▾" : "▸"} {t("project.policy.holidayCard.advanced.toggle")}
          </button>
          {advancedOpen && (
            <div className="space-y-3 pl-2">
              <p className="text-[11px] text-(--color-muted)">
                {t("project.policy.holidayCard.advanced.hint")}
              </p>
              {!holidayProfileIsLocal && (
                <button
                  type="button"
                  onClick={() => setHolidayProfileLocal({ preset: null, additions: [], exclusions: [] })}
                  className={btnGhost()}
                >
                  {t("project.policy.holidayCard.override")}
                </button>
              )}
              {holidayProfileIsLocal && (
                <>
                  <button
                    type="button"
                    onClick={() => setHolidayProfileLocal(null)}
                    className={btnGhost()}
                  >
                    {t("project.policy.holidayCard.clearOverride")}
                  </button>
                  <HolidayProfileEditor
                    value={holidayProfileLocal!}
                    onChange={setHolidayProfileLocal}
                    countries={(countries.data ?? []).map((c) => c.presetKey)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {saveError && (
        <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-3 py-2">
          {saveError}
        </p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 rounded px-3 py-2">
          {t("project.policy.saved")}
        </p>
      )}

      <button type="submit" disabled={update.isPending} className={btnPrimary()}>
        {update.isPending ? t("project.policy.saving") : t("project.policy.save")}
      </button>
    </form>
  );
}

function InheritedBadge({
  isLocal,
  source,
  sourceName,
  ancestorKey,
  orgKey,
  defaultKey,
  localKey,
}: {
  isLocal: boolean;
  source: string;
  sourceName: string | null;
  ancestorKey: string;
  orgKey: string;
  defaultKey: string;
  localKey: string;
}) {
  const { t } = useTranslation();
  let label: string;
  let tone = "border-(--color-border) text-(--color-muted)";
  if (isLocal || source === "project") {
    label = t(localKey);
    tone = "border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300";
  } else if (source.startsWith("ancestor:")) {
    label = t(ancestorKey, { name: sourceName ?? "—" });
  } else if (source === "org") {
    label = t(orgKey);
  } else {
    label = t(defaultKey);
  }
  return (
    <span className={`inline-flex items-center text-[11px] rounded px-2 py-0.5 border ${tone}`}>
      {label}
    </span>
  );
}

function HolidayProfileEditor({
  value,
  onChange,
  countries,
}: {
  value: HolidayProfile;
  onChange: (next: HolidayProfile) => void;
  countries: string[];
}) {
  const additions = value.additions ?? [];
  const exclusions = value.exclusions ?? [];
  return (
    <div className="space-y-3">
      <label className="block space-y-1 max-w-xs">
        <span className="text-xs font-medium text-(--color-fg)">Regional preset</span>
        <select
          value={value.preset ?? ""}
          onChange={(e) => onChange({ ...value, preset: e.target.value || null })}
          className={inputCls()}
        >
          <option value="">— none —</option>
          {countries.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <h5 className="text-xs font-medium text-(--color-fg)">Additions</h5>
        {additions.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={a.name}
              onChange={(e) => {
                const next = [...additions];
                next[i] = { ...a, name: e.target.value };
                onChange({ ...value, additions: next });
              }}
              placeholder="Name"
              className={inputCls() + " flex-1"}
            />
            <input
              type="number" min="1" max="12"
              value={a.month}
              onChange={(e) => {
                const next = [...additions];
                next[i] = { ...a, month: parseInt(e.target.value) || 1 };
                onChange({ ...value, additions: next });
              }}
              placeholder="MM"
              className={inputCls() + " w-16"}
            />
            <input
              type="number" min="1" max="31"
              value={a.day}
              onChange={(e) => {
                const next = [...additions];
                next[i] = { ...a, day: parseInt(e.target.value) || 1 };
                onChange({ ...value, additions: next });
              }}
              placeholder="DD"
              className={inputCls() + " w-16"}
            />
            <button
              type="button"
              onClick={() => onChange({ ...value, additions: additions.filter((_, j) => j !== i) })}
              className="text-rose-500 hover:text-rose-700 text-xs"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({
            ...value,
            additions: [...additions, { name: "", month: 1, day: 1 }],
          })}
          className={btnGhost()}
        >
          + Add holiday
        </button>
      </div>

      <div className="space-y-2">
        <h5 className="text-xs font-medium text-(--color-fg)">Exclusions</h5>
        {exclusions.map((x, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={x.name}
              onChange={(e) => {
                const next = [...exclusions];
                next[i] = { ...x, name: e.target.value };
                onChange({ ...value, exclusions: next });
              }}
              placeholder="Name"
              className={inputCls() + " flex-1"}
            />
            <input
              value={x.region}
              onChange={(e) => {
                const next = [...exclusions];
                next[i] = { ...x, region: e.target.value };
                onChange({ ...value, exclusions: next });
              }}
              placeholder="Region"
              className={inputCls() + " flex-1"}
            />
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                exclusions: exclusions.filter((_, j) => j !== i),
              })}
              className="text-rose-500 hover:text-rose-700 text-xs"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({
            ...value,
            exclusions: [...exclusions, { name: "", region: "" }],
          })}
          className={btnGhost()}
        >
          + Add exclusion
        </button>
      </div>
    </div>
  );
}

// Helper return-strings reused across the file. Kept as locals (not
// shared) so the editor doesn't grow a styling sub-module.
function inputCls() {
  return "w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50";
}
function btnPrimary() {
  return "rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors";
}
function btnGhost() {
  return "text-xs text-(--color-muted) hover:text-(--color-fg) px-2 py-1 rounded-md border border-(--color-border) hover:border-indigo-300 transition-colors";
}
