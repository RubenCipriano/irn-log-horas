using Microsoft.EntityFrameworkCore;
using TimeFlow.Auth;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Integrations;
using TimeFlow.Integrations.Contract;
using TimeFlow.Vault;

namespace TimeFlow.Api.Endpoints;

// DEV-only seed: bypasses the Verify gate and writes an integration
// connection row directly. ONLY exists so Phase 8 verification can
// queue a sync against a connection whose credential will (correctly)
// fail at the upstream call — proving the full pipeline:
//   enqueue → Hangfire → worker → adapter → upstream → bucketed error
//   → terminal status row update.
//
// Gated by DEV_SMOKE=1 in Program.cs.
public static class Phase8SeedEndpoint {
    public sealed record SeedRequest(Guid OrgId, string Provider, string Name, string CredentialsJson);

    public static async Task<IResult> Handle(
        SeedRequest body,
        TimeFlowDbContext db,
        IVaultService vault,
        IIntegrationRegistry registry,
        HttpContext http) {
        var userId = AuthClaims.GetUserId(http.User);
        if (!IntegrationProviders.IsKnown(body.Provider)) {
            return Results.Json(new { error = "Unknown provider." }, statusCode: 400);
        }

        var id = Guid.NewGuid();
        var encrypted = vault.Encrypt(body.CredentialsJson, $"integration:{id:N}");
        var row = new IntegrationConnection {
            Id = id,
            OrgId = body.OrgId,
            Provider = body.Provider,
            Name = body.Name,
            EncryptedCredentials = encrypted,
            CreatedBy = userId,
        };
        db.IntegrationConnections.Add(row);
        await db.SaveChangesAsync(http.RequestAborted);
        return Results.Ok(new { id = row.Id, provider = row.Provider, name = row.Name });
    }
}
