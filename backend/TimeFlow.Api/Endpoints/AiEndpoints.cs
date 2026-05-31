using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Ai;
using TimeFlow.Ai.Contract;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Data;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/ai/* — streaming AI surfaces.
//
// Credential handling (matches the legacy contract verbatim):
//   * The provider + model + key arrive in the REQUEST BODY each call.
//   * Server never persists the key. Never logs the key. Never returns
//     the key.
//   * The key flows through to the upstream LLM and is dropped.
//
// Surfaces shipped in Phase 9:
//   * POST /api/ai/chat — generic streaming chat. Body: { config,
//     systemPrompt?, messages[] }. Streams SSE `chunk` events with
//     AiChunk payloads (delta / done / error).
//   * POST /api/orgs/{id}/ai/ask — same shape but the server prepends a
//     system prompt + a brief context block built from the caller's recent
//     worklogs in the org. Org-scoped: orgId comes from the route and is
//     verified by RequireOrgPermission before the handler runs.
//
// The other three plan-Phase-9 surfaces (status suggest, weights auto-
// tune, report explainer) all reduce to a chat call with a different
// system prompt + a small JSON-shaped response — they can land as
// thin wrappers on top of /chat once their callers are wired up
// (Phase 10's calendar + Phase 11's reports).
public static class AiEndpoints {
    public static void MapAiEndpoints(this WebApplication app) {
        // Generic streaming chat — no org context needed.
        var chatGrp = app.MapGroup("/api/ai")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Ai);

        chatGrp.MapPost("/chat", Chat);

        // Org-scoped ask: reads the caller's worklogs to build context.
        // orgId must come from the route so the RBAC filter can verify
        // membership before the handler touches any data.
        var askGrp = app.MapGroup("/api/orgs/{id:guid}/ai")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Ai);

        askGrp.MapPost("/ask", Ask).RequireOrgPermission(Permission.AiUse);
    }

    // ---------------------------------------------------------------------
    // Request shape — same for both surfaces.
    // ---------------------------------------------------------------------
    public sealed record AiChatRequest(
        [Required] AiProviderConfigDto Config,
        string? SystemPrompt,
        [Required] List<AiMessageDto> Messages);

    public sealed record AiProviderConfigDto(
        [Required] string Provider,
        [Required] string Model,
        string? ApiKey,
        string? BaseUrl,
        decimal? Temperature,
        int? MaxTokens);

    public sealed record AiMessageDto(
        [Required] string Role,
        [Required] string Content);

    // ---------------------------------------------------------------------
    // POST /api/ai/chat
    // ---------------------------------------------------------------------
    public static async Task Chat(
        AiChatRequest body,
        HttpContext http,
        IAiProviderRegistry registry,
        CancellationToken ct) {
        await StreamChatAsync(body, body.SystemPrompt, http, registry, ct);
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/ai/ask — same shape as /chat, but the server
    // prepends a context block built from the caller's own worklogs in the
    // org for the past two weeks.
    //
    // orgId comes from the route (not a query string) so RequireOrgPermission
    // can verify membership before this handler is invoked. Resolving it from
    // http.RequireOrgContext() is the load-bearing contract that prevents
    // cross-tenant data disclosure.
    // ---------------------------------------------------------------------
    public static async Task Ask(
        Guid id,
        AiChatRequest body,
        HttpContext http,
        IAiProviderRegistry registry,
        TimeFlowDbContext db,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        var context = userId is null
            ? null
            : await BuildWorklogContextAsync(db, orgId, userId.Value, ct);
        var systemPrompt = ComposeSystemPrompt(body.SystemPrompt, context);
        await StreamChatAsync(body, systemPrompt, http, registry, ct);
    }

    // ---------------------------------------------------------------------
    // Internal — shared streaming pipeline.
    // ---------------------------------------------------------------------
    private static async Task StreamChatAsync(
        AiChatRequest body,
        string? systemPrompt,
        HttpContext http,
        IAiProviderRegistry registry,
        CancellationToken ct) {
        // Validate + normalise BEFORE we touch the response. After we
        // start writing SSE we're committed to 200 — errors land as
        // streamed chunks, not HTTP statuses.
        if (!MiniValidator.TryValidate(body, out var errors)) {
            await http.Response.WriteAsJsonAsync(new { error = "Validation failed.", errors }, ct);
            http.Response.StatusCode = 400;
            return;
        }
        if (!AiProviders.IsKnown(body.Config.Provider)) {
            http.Response.StatusCode = 400;
            await http.Response.WriteAsJsonAsync(new { error = "Unknown AI provider." }, ct);
            return;
        }
        if (body.Messages.Count == 0) {
            http.Response.StatusCode = 400;
            await http.Response.WriteAsJsonAsync(new { error = "messages must contain at least one entry." }, ct);
            return;
        }
        // Hard caps on the inbound chat history so a misbehaving (or
        // malicious) client can't push a 1GB request body through the
        // streaming pipeline. Counts: 50 messages, 20k chars each, 200k total.
        const int MaxMessages = 50;
        const int MaxMessageChars = 20_000;
        const int MaxTotalChars = 200_000;
        if (body.Messages.Count > MaxMessages) {
            http.Response.StatusCode = 413;
            await http.Response.WriteAsJsonAsync(new { error = $"messages exceeds {MaxMessages}." }, ct);
            return;
        }
        var totalChars = 0;
        foreach (var m in body.Messages) {
            var len = m.Content?.Length ?? 0;
            if (len > MaxMessageChars) {
                http.Response.StatusCode = 413;
                await http.Response.WriteAsJsonAsync(new { error = $"A message exceeds {MaxMessageChars} chars." }, ct);
                return;
            }
            totalChars += len;
        }
        if (totalChars > MaxTotalChars) {
            http.Response.StatusCode = 413;
            await http.Response.WriteAsJsonAsync(new { error = $"Total messages content exceeds {MaxTotalChars} chars." }, ct);
            return;
        }

        var config = new AiProviderConfig(
            body.Config.Provider, body.Config.Model,
            body.Config.ApiKey, body.Config.BaseUrl,
            body.Config.Temperature, body.Config.MaxTokens);

        var messages = body.Messages.Select(m => new AiMessage(
            ParseRole(m.Role), m.Content ?? "")).ToList();

        var adapter = registry.Get(body.Config.Provider);
        var stream = adapter.StreamAsync(config, systemPrompt, messages, ct);
        await http.Response.WriteStreamAsync(stream, eventName: "chunk", ct);
    }

    private static AiRole ParseRole(string role) => role.ToLowerInvariant() switch {
        "user" => AiRole.User,
        "assistant" => AiRole.Assistant,
        _ => AiRole.User,
    };

    // ---------------------------------------------------------------------
    // Context builder — used by /ask. Pulls the caller's worklogs for the
    // current week + last week and formats them as a compact bullet list.
    // Tiny on purpose: large RAG is a separate concern.
    // ---------------------------------------------------------------------
    private static async Task<string?> BuildWorklogContextAsync(
        TimeFlowDbContext db, Guid orgId, Guid userId, CancellationToken ct) {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = today.AddDays(-14);
        var rows = await db.Worklogs
            .Where(w => w.OrgId == orgId && w.UserId == userId && w.WorkDate >= from && w.WorkDate <= today)
            .OrderBy(w => w.WorkDate)
            .Select(w => new { w.WorkDate, w.Hours, w.Notes, w.ProjectId })
            .Take(80)
            .ToListAsync(ct);

        if (rows.Count == 0) return null;
        var sb = new System.Text.StringBuilder("Recent worklogs:\n");
        foreach (var r in rows) {
            sb.Append("- ").Append(r.WorkDate.ToString("yyyy-MM-dd"))
                .Append(" · ").Append(r.Hours).Append("h");
            if (!string.IsNullOrWhiteSpace(r.Notes)) {
                sb.Append(" · ").Append(r.Notes!.Length > 120 ? r.Notes[..120] + "…" : r.Notes);
            }
            sb.Append('\n');
        }
        return sb.ToString();
    }

    private static string? ComposeSystemPrompt(string? userSystem, string? context) {
        if (string.IsNullOrWhiteSpace(userSystem) && string.IsNullOrWhiteSpace(context)) return null;
        if (string.IsNullOrWhiteSpace(context)) return userSystem;
        if (string.IsNullOrWhiteSpace(userSystem)) return context;
        return userSystem + "\n\n" + context;
    }
}
