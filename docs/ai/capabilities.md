# AI Capabilities — Developer Spec

Mirror of the charter's "Capacidades" section, with implementation detail.

## Action schema

```ts
export type AIAction =
  | {
      kind: "log_hours";
      taskId: string;
      taskTitle: string;
      dayKey: string;          // "YYYY-MM-DD"
      hours: number;           // multiple of 0.5
      reason: string;
      confidence?: number;     // 0..1
      source?: "ai" | "gitlab" | "manual";
    }
  | {
      kind: "update_status";
      taskId: string;
      taskTitle: string;
      fromStatusId?: string;
      fromStatusName?: string;
      toStatusId: string;
      toStatusName: string;
      reason: string;
      confidence?: number;
      source?: "ai" | "gitlab";
    };
```

## Apply pipeline

`lib/ai/orchestrator.ts` exposes `applyActions(actions, ctx)` which:

1. Splits the action list by `kind`.
2. Groups `log_hours` by `dayKey` → one POST to `/api/openproject/add-time-entries` per day.
3. Iterates `update_status` sequentially → one POST per action to
   `/api/openproject/update-status` (must be sequential because each status change
   bumps `lockVersion`).
4. Tracks per-item success/failure. Partial success is normal — the modal stays
   open with failed rows flagged red, succeeded rows disappear or get a green check.
5. Emits an audit log entry (via `useAuditLog`) for every succeeded action.

## Backwards compatibility

Older `AIDistributionItem` callers (Phases 1-11) still work: the type is
re-exported as a deprecated alias. `parseDistributeResponse` accepts both the
legacy `{items: [...]}` shape and the new `{actions: [...]}` shape.

## Server-side enforcement

The two write routes still require explicit calls per item — there is no
batch "apply plan" endpoint. The charter rule "Nunca executas" is enforced at
the protocol level, not just by prompt.
