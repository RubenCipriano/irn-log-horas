import type { AIAction, AILogHoursAction, AIUpdateStatusAction } from "@/types";

// Client-side apply pipeline (Phase 12). Takes an approved plan and dispatches
// it to the two existing OpenProject write routes. Per-action success/failure
// tracking lets the modal show partial-success state (failed rows stay,
// succeeded rows disappear).

export type ApplyContext = {
  authToken: string;
  authUrl: string;
  // For optimistic-locking on update_status: callers must pass the task's
  // current lockVersion. The orchestrator does not have access to it.
  lockVersionByTaskId: Record<string, number | undefined>;
};

export type ActionResult = {
  action: AIAction;
  ok: boolean;
  message?: string;
  // For update_status: the new lockVersion + statusId returned by OpenProject,
  // so callers can update local task state without a round-trip.
  nextLockVersion?: number;
  nextStatusId?: string;
  nextStatusName?: string;
};

// Group log_hours by dayKey so we can use the existing batch endpoint.
function groupHoursByDay(actions: AILogHoursAction[]): Map<string, AILogHoursAction[]> {
  const byDay = new Map<string, AILogHoursAction[]>();
  for (const a of actions) {
    if (!byDay.has(a.dayKey)) byDay.set(a.dayKey, []);
    byDay.get(a.dayKey)!.push(a);
  }
  return byDay;
}

async function applyHoursForDay(
  ctx: ApplyContext,
  dayKey: string,
  actions: AILogHoursAction[],
): Promise<ActionResult[]> {
  try {
    const response = await fetch("/api/openproject/add-time-entries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.authToken}`,
        "X-OpenProject-URL": ctx.authUrl,
      },
      body: JSON.stringify({
        date: dayKey,
        entries: actions.map(a => ({ taskId: a.taskId, hours: a.hours, comment: a.reason })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data?.message || `HTTP ${response.status}`;
      return actions.map(a => ({ action: a, ok: false, message: msg }));
    }
    return actions.map(a => ({ action: a, ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro de rede";
    return actions.map(a => ({ action: a, ok: false, message: msg }));
  }
}

async function applyStatusChange(
  ctx: ApplyContext,
  action: AIUpdateStatusAction,
): Promise<ActionResult> {
  const lockVersion = ctx.lockVersionByTaskId[action.taskId];
  if (typeof lockVersion !== "number") {
    return { action, ok: false, message: "Falta lockVersion — recarrega a sessao." };
  }
  try {
    const response = await fetch("/api/openproject/update-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.authToken}`,
        "X-OpenProject-URL": ctx.authUrl,
      },
      body: JSON.stringify({
        taskId: action.taskId,
        statusId: action.toStatusId,
        lockVersion,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { action, ok: false, message: data?.message || `HTTP ${response.status}` };
    }
    return {
      action,
      ok: true,
      nextLockVersion: typeof data.lockVersion === "number" ? data.lockVersion : lockVersion + 1,
      nextStatusId: data.statusId || action.toStatusId,
      nextStatusName: data.status || action.toStatusName,
    };
  } catch (err) {
    return { action, ok: false, message: err instanceof Error ? err.message : "erro de rede" };
  }
}

export async function applyActions(actions: AIAction[], ctx: ApplyContext): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  const hourActions = actions.filter((a): a is AILogHoursAction => a.kind === "log_hours");
  const statusActions = actions.filter((a): a is AIUpdateStatusAction => a.kind === "update_status");

  // Hours: parallel per day (each day is one API call).
  const byDay = groupHoursByDay(hourActions);
  const dayResults = await Promise.all(
    Array.from(byDay.entries()).map(([day, acts]) => applyHoursForDay(ctx, day, acts)),
  );
  for (const r of dayResults) results.push(...r);

  // Statuses: sequential (lockVersion updates after each call). Bump the local
  // lockVersion as we go so a multi-step transition on the same task chains.
  const localLockVersion = { ...ctx.lockVersionByTaskId };
  for (const action of statusActions) {
    const result = await applyStatusChange({ ...ctx, lockVersionByTaskId: localLockVersion }, action);
    if (result.ok && typeof result.nextLockVersion === "number") {
      localLockVersion[action.taskId] = result.nextLockVersion;
    }
    results.push(result);
  }

  return results;
}
