# AI Flow

End-to-end: natural-language palette input → multi-action plan → apply.

```
┌────────────────────┐    Ctrl+K     ┌──────────────────┐
│   AppShell        ─┼──────────────►│ CommandPalette   │
└────────────────────┘               └────────┬─────────┘
                                              │ submit
                          ┌───────────────────▼──────────────────┐
                          │ Safety mode ON?                      │
                          │  YES → "understand-first" call       │
                          │   → palette shows interpretation     │
                          │   → user clicks Avancar              │
                          │  NO  → straight to plan call         │
                          └───────────────────┬──────────────────┘
                                              │
                          ┌───────────────────▼──────────────────┐
                          │  /api/ai/distribute                  │
                          │   ↓ lib/ai/orchestrator              │
                          │   ↓ provider.chat(...)               │
                          │   ↓ parseDistributeResponse          │
                          │  → { actions[], reasoning, debug }   │
                          └───────────────────┬──────────────────┘
                                              │
                          ┌───────────────────▼──────────────────┐
                          │  AIPreviewModal                      │
                          │  • Filter chips                      │
                          │  • Hour rows + Status-change rows    │
                          │  • Edit per row, then Aplicar        │
                          └───────────────────┬──────────────────┘
                                              │ "Aplicar"
                          ┌───────────────────▼──────────────────┐
                          │  applyActions(actions, ctx)          │
                          │   ↓ /api/openproject/add-time-entries│
                          │   ↓ /api/openproject/update-status   │
                          │  → audit log + toast                 │
                          └──────────────────────────────────────┘
```

## Key files

- `components/CommandPalette/index.tsx` — input + progress steps + Cancelar.
- `lib/ai/charter.ts` — loads `docs/ai/charter.md?raw` as the system prompt.
- `lib/ai/prompt.ts` — builds the user message + parses responses.
- `lib/ai/orchestrator.ts` — GitLab baseline + LLM call + retry + clamp +
  multi-action apply pipeline.
- `lib/ai/provider.ts` + adapters — pluggable LLM providers via `fetch`.
- `components/AIPreviewModal/*.tsx` — split per concern (ReasoningPanel,
  WarningsBanner, DayGroup, ActionRow, Inspector overlay, …).
- `hooks/useAISafetyMode.ts` — localStorage `ai_safety_mode_v1`.
- `hooks/useAuditLog.ts` — append-only audit ring of last 200 entries.
- `hooks/calendar/useAIFlow.ts` — view-agnostic palette/preview wiring.

## Adding a new action kind

1. Extend `AIAction` in `types/index.ts`.
2. Document the new kind in `docs/ai/charter.md` (the charter IS the prompt).
3. Extend `parseDistributeResponse` to handle the new shape.
4. Extend `applyActions` in `lib/ai/orchestrator.ts` to dispatch it.
5. Extend `ActionRow` in `components/AIPreviewModal/ActionRow.tsx` to render it.

No provider-side changes needed — the JSON schema is updated automatically.
