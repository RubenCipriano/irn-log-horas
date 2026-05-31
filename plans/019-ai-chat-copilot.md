# Plan 019 — AI chat copilot (multi-turn distribute with tool use)

**Created**: 2026-05-25
**Depends on**: Plan 018 (billing tiers + AI distribute one-shot)
**Status**: Spec ready. Not started.

> Plan 018's one-shot "describe → distribute → confirm" works but is fragile: if the AI misreads which task you meant, you have to cancel and re-type the whole description. Plan 019 turns it into a chat — the model can ask "do you mean #32195 (the rejection UI) or #32287 (the rejection API)?", you reply, hours land. Same data, much higher hit rate.

---

## 1. Why this slice exists

User feedback paraphrased: *"Maybe we should add something like Copilot — a chat that has the ability to put hours."*

The one-shot dialog from 018 maps to: prompt → JSON → preview → save. Three failure modes:
1. **Ambiguity** — "I worked on rejections" matches three tasks; the AI guesses wrong. User cancels, retypes "the rejection UI".
2. **Missing context** — user says "the bug from yesterday's meeting"; the AI doesn't know which bug.
3. **Mid-conversation adjustment** — "actually move 1h from #32195 to the meetings task". One-shot can't.

Chat fixes all three. The model holds conversation state, can ask follow-ups, and the user can iterate without losing the previous turn.

---

## 2. Scope

### In scope

**Multi-turn chat surface** ([apps/cloud/app/calendar/ai-chat-copilot.tsx](apps/cloud/app/calendar/ai-chat-copilot.tsx) — new):
- Sidebar-style panel that slides in from the right (same pattern as DayDetail).
- Message log: user messages on right (indigo), AI messages on left (slate), system events (tool calls, "logged 2h to #32195") as muted center-aligned chips.
- Input at bottom with auto-expanding textarea + send button + "🛑 Stop generating" while busy.
- "📋 Apply N changes" CTA appears when the AI proposes hours but hasn't logged them yet — same preview-then-apply gate as the one-shot dialog.
- "Limpar conversa" resets the thread; "X" closes the panel.

**Streaming responses** ([apps/cloud/lib/ai-stream.ts](apps/cloud/lib/ai-stream.ts) — new):
- New `/api/ai/chat` endpoint streams Server-Sent Events.
- Each provider's adapter gains a `chatStream(messages, opts)` method that yields chunks (already supported by `@timeflow/ai` types — the OSS web app uses it).
- Client uses `fetch` + `body.getReader()` (no EventSource — we're POSTing) to surface partial tokens as they arrive.

**Tool use / function calling**:
- Anthropic's `tools` API + OpenAI-compatible `tool_calls`. The model calls structured functions instead of returning JSON in prose:
  - `propose_distribution(items: [{taskId, hours, reason}])` — proposes a distribution for user to confirm
  - `clarify(question: string, options?: string[])` — asks the user a question, optionally with quick-reply buttons
  - `final_message(text: string)` — closing message after the user confirms
- Each tool call surfaces in the UI as a system event chip the user can act on directly.
- Server validates every `propose_distribution` against the candidate set BEFORE rendering it as a preview — same defence as the one-shot endpoint.

**Conversation persistence** (`user_preferences.aiConversations` JSON):
- Last 5 conversations stored per (user, dayKey). Survives reload. Privacy: cleared when the user clears AI provider config.
- Server-side: in-memory cache only for the active turn; the persisted state is the message list.

**Feature-gated** by `ai_chat` (new feature, Team+). Same `@timeflow/billing` machinery; one row in the matrix.

### Explicitly out of scope (defer to 019-followup)

- Cross-day chat ("log 2h yesterday and 4h today on #32195") — needs the tool to accept a date param. Easy add but punted to keep the MVP focused on a single day.
- GitLab activity in the chat context — needs the cloud GitLab adapter's `listUserActivity` to land first.
- "Talk about my hours this week" / aggregation queries — these are read queries with a different tool surface. Plan 020-something.
- Speech-to-text input — small UX win, big provider-config slice. Defer.

---

## 3. Architecture sketch

```
Calendar day modal
  └─ "🪄 IA" button (now opens chat instead of one-shot dialog)
       └─ AIChatCopilot panel (client)
            ├─ Message log (streamed)
            ├─ Tool-call chips (propose_distribution → apply CTA)
            └─ Input
                 └─ POST /api/ai/chat (streaming)
                      ├─ requireOrgRole(orgId, "developer")
                      ├─ requireFeature(orgId, "ai_chat")
                      ├─ readAIProviderConfig (vault-decrypted)
                      ├─ provider.chatStream({ messages, tools, signal })
                      └─ Stream chunks → SSE → client
                           └─ On propose_distribution tool call:
                                 server validates against candidates
                                 emits "preview" event with sanitized items
                                 client renders the apply CTA
```

The "apply" path still goes through the existing `POST /api/orgs/[id]/integrations/[integrationId]/worklog` endpoint — no new write path. Audit still captures `ai.distributed` per item.

---

## 4. Security checks

| Check | Where |
|---|---|
| Tool args validated server-side before surfacing to client (taskId must be in candidate set, hours in valid range) | `/api/ai/chat` route |
| Conversation history capped at 50 turns; older turns truncated server-side before sending to provider (token budget + DoS) | route |
| Per-user rate limit reused (`adapter_call`) — 60 messages/min is generous for a chat | route |
| Streaming response abortable via `AbortController`; client "Stop generating" closes the socket | route |
| Audit per turn: `ai.chat_turn` action with token-count + tool-call summary, NEVER the user's prompt text or AI's response content | route |
| Conversation persistence respects user erasure — `account.deleted` cascade drops the JSON | schema cascade — already in place since the column lives on `user_preferences` |

---

## 5. Implementation phases

### 019-α — One-shot retains, chat ADDS (this is the first deliverable)
- New `/api/ai/chat` endpoint + streaming infra.
- New chat UI; the IA button gets a "Chat" / "Quick" toggle initially so both flows are reachable.
- After 2 weeks of usage telemetry, decide whether to retire the one-shot or keep both.

### 019-β — Tool use across all providers
- Anthropic native `tools` API.
- OpenAI-compatible `tool_calls` for OpenRouter / Groq / OpenAI-compat.
- Gemini's function declarations.
- Ollama: text-mode tool-use fallback (prompt the model to emit a structured marker the parser detects).

### 019-γ — Conversation persistence
- Schema column + read/write helpers in `apps/cloud/lib/ai-conversations.ts`.
- Auto-resume the previous conversation when the user re-opens the chat for the same day.

### 019-δ — Cross-day + GitLab context
- Once 018-γ-followup ships GitLab activity, plumb it into the chat's system prompt as context. Same "I see you pushed 3 commits to project X this morning — were any of these for #32195?" pattern apps/web has.

---

## 6. Estimated effort

- α streaming + basic chat: 1.5 days
- β tool use (Anthropic native + OpenAI shape): 1 day
- γ persistence: 0.5 day
- δ GitLab context: 0.5 day (after 018-γ-followup lands)

**Total: ~3.5 days.** Probably 3 sessions.

---

## 7. Acceptance criteria (α only — first deliverable)

- [ ] User clicks IA → chat panel opens.
- [ ] User types "I worked on rejection bug" → AI streams a clarifying question ("which rejection — the UI #32195 or the API #32287?").
- [ ] User answers → AI proposes distribution → user clicks Apply → hours land.
- [ ] Conversation survives modal close + reopen for the same day.
- [ ] Server-side audit captures one `ai.chat_turn` per turn.
- [ ] Stop generating button cancels mid-stream cleanly.

---

## 8. Follow-up

- Plan 020 — Stripe lifecycle (so `ai_chat` can actually be a paid gate).
- Plan 021 — Streaming for ALL providers (the one-shot endpoint can stream too once the infra lands here).
- Plan 022 — Annual pricing + discount codes.
