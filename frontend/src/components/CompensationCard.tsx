"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useUpdateMemberCompensation,
  type PayCadence,
} from "@/hooks/useMembers";

// Edit-in-place compensation card. Lives at the top of the member-detail
// hours block, just BEFORE the Paycheck card so the user sees the rate
// they're being paid at before the resulting figure.
//
// Visibility / edit gates:
//   * Card itself: rendered only when the caller has BillingRead (the
//     server returns the rate fields null otherwise — we treat all-null
//     compensation as "hidden").
//   * Edit pencil: rendered only when canEdit is true. The caller passes
//     this in based on yourRole (Manager+).
//
// Cadence semantics:
//   * Server may return payCadence === null on legacy rows. We render
//     'hourly' as the active cadence in that case; the next save persists
//     an explicit value.
//   * On save we send ALL THREE rate slots so toggling cadence later
//     remembers the prior value (server-side decision 1).
export function CompensationCard({
  orgId,
  userId,
  canEdit,
  payCadence,
  hourlyRate,
  dailyRate,
  monthlyRate,
}: {
  orgId: string;
  userId: string;
  canEdit: boolean;
  payCadence: PayCadence | null;
  hourlyRate: number | null;
  dailyRate: number | null;
  monthlyRate: number | null;
}) {
  const { t } = useTranslation();
  const update = useUpdateMemberCompensation(orgId, userId);

  const activeCadence: PayCadence = payCadence ?? "hourly";

  const [editing, setEditing] = useState(false);
  const [draftCadence, setDraftCadence] = useState<PayCadence>(activeCadence);
  const [draftHourly, setDraftHourly] = useState<string>(
    hourlyRate === null ? "" : String(hourlyRate),
  );
  const [draftDaily, setDraftDaily] = useState<string>(
    dailyRate === null ? "" : String(dailyRate),
  );
  const [draftMonthly, setDraftMonthly] = useState<string>(
    monthlyRate === null ? "" : String(monthlyRate),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Re-sync drafts when the server pushes a new value (e.g. another tab
  // edited the same membership) — but only while we're not actively
  // editing, to avoid clobbering the user's in-progress changes.
  useEffect(() => {
    if (editing) return;
    setDraftCadence(activeCadence);
    setDraftHourly(hourlyRate === null ? "" : String(hourlyRate));
    setDraftDaily(dailyRate === null ? "" : String(dailyRate));
    setDraftMonthly(monthlyRate === null ? "" : String(monthlyRate));
  }, [editing, activeCadence, hourlyRate, dailyRate, monthlyRate]);

  function cancel() {
    setDraftCadence(activeCadence);
    setDraftHourly(hourlyRate === null ? "" : String(hourlyRate));
    setDraftDaily(dailyRate === null ? "" : String(dailyRate));
    setDraftMonthly(monthlyRate === null ? "" : String(monthlyRate));
    setValidationError(null);
    setServerError(null);
    setEditing(false);
  }

  // Parses a draft input. Empty string -> null (clearing the slot).
  // Non-numeric / negative / non-finite -> returns the sentinel `Invalid`
  // so the caller can flag it. We DON'T silently coerce to 0.
  function parseDraft(raw: string): number | null | "invalid" {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return "invalid";
    return n;
  }

  async function save() {
    setValidationError(null);
    setServerError(null);

    const hourly = parseDraft(draftHourly);
    const daily = parseDraft(draftDaily);
    const monthly = parseDraft(draftMonthly);

    if (hourly === "invalid" || daily === "invalid" || monthly === "invalid") {
      setValidationError(t("members.compensation.rate_required_for_cadence"));
      return;
    }

    // Client-side enforcement of the server's "rate matching cadence
    // must be non-null" rule (server returns 400 with the same code
    // otherwise; better UX to catch it here).
    const activeRate =
      draftCadence === "hourly"
        ? hourly
        : draftCadence === "daily"
          ? daily
          : monthly;
    if (activeRate === null) {
      setValidationError(t("members.compensation.rate_required_for_cadence"));
      return;
    }

    try {
      await update.mutateAsync({
        cadence: draftCadence,
        hourlyRate: hourly,
        dailyRate: daily,
        monthlyRate: monthly,
      });
      setEditing(false);
    } catch (err) {
      setServerError(extractErr(err) ?? t("members.compensation.save_error"));
    }
  }

  const showOtherRatesHint =
    !editing &&
    (hourlyRate !== null || dailyRate !== null || monthlyRate !== null);
  const otherRates = collectOtherRates(
    activeCadence,
    hourlyRate,
    dailyRate,
    monthlyRate,
    t,
  );

  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-4">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-(--color-fg)">
          {t("members.compensation.title")}
        </h2>
        {canEdit ? (
          !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-indigo-600 hover:underline"
            >
              {t("members.compensation.edit")}
            </button>
          )
        ) : (
          <span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase bg-(--color-bg) text-(--color-muted)">
            {t("members.compensation.read_only")}
          </span>
        )}
      </header>

      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-(--color-muted)">
              {t("members.compensation.cadence_label")}
            </p>
            <CadencePillGroup
              value={draftCadence}
              onChange={setDraftCadence}
              disabled={update.isPending}
              t={t}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <RateInput
              label={t("members.compensation.hourly_rate")}
              value={draftHourly}
              onChange={setDraftHourly}
              active={draftCadence === "hourly"}
              disabled={update.isPending}
            />
            <RateInput
              label={t("members.compensation.daily_rate")}
              value={draftDaily}
              onChange={setDraftDaily}
              active={draftCadence === "daily"}
              disabled={update.isPending}
            />
            <RateInput
              label={t("members.compensation.monthly_rate")}
              value={draftMonthly}
              onChange={setDraftMonthly}
              active={draftCadence === "monthly"}
              disabled={update.isPending}
            />
          </div>

          {validationError && (
            <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
              {validationError}
            </p>
          )}
          {serverError && (
            <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
              {serverError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {update.isPending
                ? t("common.saving")
                : t("members.compensation.save")}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={update.isPending}
              className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-3 py-1.5 text-xs font-medium hover:border-indigo-300 disabled:opacity-50 transition-colors"
            >
              {t("members.compensation.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("members.compensation.cadence_label")}
              value={t(`members.compensation.cadence.${activeCadence}`)}
            />
            <Field
              label={cadenceRateLabel(activeCadence, t)}
              value={fmtRate(
                activeRateValue(activeCadence, hourlyRate, dailyRate, monthlyRate),
                t,
              )}
            />
          </div>
          {showOtherRatesHint && otherRates && (
            <p className="text-xs text-(--color-muted)">
              {t("members.compensation.other_rates_hint")} {otherRates}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CadencePillGroup({
  value,
  onChange,
  disabled,
  t,
}: {
  value: PayCadence;
  onChange: (v: PayCadence) => void;
  disabled: boolean;
  t: (key: string) => string;
}) {
  const options: PayCadence[] = ["hourly", "daily", "monthly"];
  return (
    <div
      role="radiogroup"
      aria-label={t("members.compensation.cadence_label")}
      className="inline-flex items-center rounded-md border border-(--color-border) bg-(--color-bg) p-0.5"
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={
              "px-3 py-1 text-xs font-medium rounded transition-colors " +
              (active
                ? "bg-indigo-600 text-white"
                : "text-(--color-muted) hover:text-(--color-fg)") +
              (disabled ? " opacity-50 cursor-not-allowed" : "")
            }
          >
            {t(`members.compensation.cadence.${opt}`)}
          </button>
        );
      })}
    </div>
  );
}

function RateInput({
  label,
  value,
  onChange,
  active,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  active: boolean;
  disabled: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span
        className={
          "text-[11px] uppercase tracking-wider " +
          (active ? "text-(--color-fg)" : "text-(--color-muted)")
        }
      >
        {label}
        {active && <span className="text-indigo-600 ml-1">•</span>}
      </span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={
          "w-full rounded-md border bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm font-mono focus:outline-none disabled:opacity-50 " +
          (active
            ? "border-indigo-500 focus:border-indigo-600"
            : "border-(--color-border) focus:border-indigo-500")
        }
      />
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-bg) p-3">
      <p className="text-[11px] uppercase tracking-wider text-(--color-muted)">
        {label}
      </p>
      <p className="text-lg font-semibold mt-1 text-(--color-fg)">{value}</p>
    </div>
  );
}

function cadenceRateLabel(c: PayCadence, t: (key: string) => string): string {
  switch (c) {
    case "hourly":
      return t("members.compensation.hourly_rate");
    case "daily":
      return t("members.compensation.daily_rate");
    case "monthly":
      return t("members.compensation.monthly_rate");
  }
}

function activeRateValue(
  c: PayCadence,
  h: number | null,
  d: number | null,
  m: number | null,
): number | null {
  switch (c) {
    case "hourly":
      return h;
    case "daily":
      return d;
    case "monthly":
      return m;
  }
}

function fmtRate(v: number | null | undefined, t: (key: string) => string): string {
  if (v == null || !Number.isFinite(v)) return t("members.compensation.empty");
  return v.toFixed(2);
}

// Builds the "other saved values: hourly 10.00 · monthly 1500.00" string
// shown beneath the active rate in read mode. Returns null if no other
// slot has a value to display.
function collectOtherRates(
  active: PayCadence,
  h: number | null,
  d: number | null,
  m: number | null,
  t: (key: string) => string,
): string | null {
  const parts: string[] = [];
  if (active !== "hourly" && h !== null) {
    parts.push(`${t("members.compensation.cadence.hourly")} ${h.toFixed(2)}`);
  }
  if (active !== "daily" && d !== null) {
    parts.push(`${t("members.compensation.cadence.daily")} ${d.toFixed(2)}`);
  }
  if (active !== "monthly" && m !== null) {
    parts.push(`${t("members.compensation.cadence.monthly")} ${m.toFixed(2)}`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function extractErr(err: unknown): string | null {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === "object" && "error" in data) {
      const e = (data as { error?: unknown }).error;
      if (typeof e === "string") return e;
    }
  }
  return null;
}
