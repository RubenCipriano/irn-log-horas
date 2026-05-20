# AI Safety

Three layers, weakest to strongest:

## 1. Charter rule (soft)

The charter explicitly tells the model "nunca executas, so propoes". This is
the cheapest layer — the model itself refuses to claim it has done anything.

## 2. Understand-first toggle (default ON)

When `ai_safety_mode_v1 === "on"` in localStorage, the palette flow is two-step:

1. First call uses a minimal prompt that asks for `{"interpretation": "..."}`
   only. The model paraphrases what the user asked, with no plan.
2. The palette shows "Aqui esta o que entendi: <interpretation>" with three
   buttons:
   - **Avancar** — fires the full plan call → preview modal as today.
   - **Reformular** — palette reopens with the original text for editing.
   - **Saltar seguranca** — skips the paraphrase for this one call only
     (does not change the saved toggle).

Toggle lives in Settings → IA tab. Default is `"on"` for new installs.

## 3. Explicit "Aplicar" click (hard)

The preview modal NEVER auto-applies. No keyboard shortcut bypasses it. The
two server routes (`add-time-entries`, `update-status`) require one explicit
client-side call per action. There is no batch endpoint.

## Audit log

Every succeeded action is appended to `audit_log_v1` localStorage with shape:

```ts
{
  ts: string;          // ISO 8601
  kind: "log_hours" | "update_status";
  taskId: string;
  taskTitle: string;
  before: string | number | null;
  after: string | number;
  source: "ai" | "gitlab" | "manual";
}
```

Cap: last 200 entries (older entries are dropped). Visible in Settings →
Historico tab. Filter by kind + source.

## Threat model (what this does NOT prevent)

- A compromised LLM cannot make hours appear on its own — every action needs
  a click. But a compromised LLM CAN propose mass-deletion or mass-status-
  change actions. The user is the last line of defence; review the preview.
- Provider keys live in localStorage. An attacker with DOM access can read
  them. This is the same risk profile as any in-browser API client.
