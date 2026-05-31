using TimeFlow.Cache;
using TimeFlow.Rbac;
using TimeFlow.Vault;

namespace TimeFlow.Api.Endpoints;

// Gated smoke endpoint that exercises the Phase 4 services end-to-end
// against the real Redis + Vault wiring inside the container. Only
// mapped when DEV_SMOKE=1 is set — keep it OFF in production envs.
//
// Used by the Phase 4 verification step + future "is the container
// wired right" sanity checks. It's a stub on purpose: not a load test,
// not a feature, just a one-shot pass/fail.
public static class Phase4SmokeEndpoint {
    public static async Task<IResult> Handle(IVaultService vault, ICacheStore cache) {
        var results = new List<object>();
        var allOk = true;

        // ---- Vault ---------------------------------------------------
        try {
            var orgA = Guid.NewGuid().ToString("D");
            var orgB = Guid.NewGuid().ToString("D");
            var secret = "openproject-pat-" + Guid.NewGuid().ToString("N");
            var envelope = vault.Encrypt(secret, orgA);
            var roundtrip = vault.Decrypt(envelope, orgA);
            if (roundtrip != secret) throw new Exception("Round-trip mismatch.");

            // Wrong context MUST fail (cross-tenant safety).
            var crossContextFailed = false;
            try { vault.Decrypt(envelope, orgB); }
            catch (Exception) { crossContextFailed = true; }
            if (!crossContextFailed) throw new Exception("Cross-context decrypt did NOT fail.");

            results.Add(new { test = "vault", ok = true });
        } catch (Exception ex) {
            allOk = false;
            results.Add(new { test = "vault", ok = false, error = ex.Message });
        }

        // ---- Cache ---------------------------------------------------
        try {
            var key = "smoke:" + Guid.NewGuid().ToString("N");
            var tag = "smoke:tag:" + Guid.NewGuid().ToString("N");
            var loaderCalls = 0;
            Func<CancellationToken, Task<string>> loader = _ => {
                Interlocked.Increment(ref loaderCalls);
                return Task.FromResult("loaded-" + loaderCalls);
            };

            // 1st call → miss → loader fires.
            var first = await cache.GetOrSetAsync(key, TimeSpan.FromMinutes(1), new[] { tag }, loader);
            // 2nd call → hit → loader stays at 1.
            var second = await cache.GetOrSetAsync(key, TimeSpan.FromMinutes(1), new[] { tag }, loader);
            if (first != second || loaderCalls != 1) {
                throw new Exception($"Cache didn't dedupe (loaderCalls={loaderCalls}, first={first}, second={second}).");
            }

            // Invalidate by tag → loader fires again.
            await cache.InvalidateTagsAsync(new[] { tag });
            var third = await cache.GetOrSetAsync(key, TimeSpan.FromMinutes(1), new[] { tag }, loader);
            if (loaderCalls != 2) {
                throw new Exception($"Tag invalidation didn't drop the entry (loaderCalls={loaderCalls}).");
            }

            // Direct invalidate works.
            await cache.InvalidateKeyAsync(key);
            var fourth = await cache.GetOrSetAsync(key, TimeSpan.FromMinutes(1), new[] { tag }, loader);
            if (loaderCalls != 3) {
                throw new Exception($"Key invalidation didn't drop the entry (loaderCalls={loaderCalls}).");
            }

            results.Add(new { test = "cache", ok = true });
        } catch (Exception ex) {
            allOk = false;
            results.Add(new { test = "cache", ok = false, error = ex.Message });
        }

        // ---- RBAC ----------------------------------------------------
        try {
            // Sample the matrix — owner has everything, viewer has reads only.
            var ownerCanDelete = PermissionMatrix.Can(OrgRole.Owner, Permission.OrgDelete);
            var viewerCanDelete = PermissionMatrix.Can(OrgRole.Viewer, Permission.OrgDelete);
            var viewerCanRead = PermissionMatrix.Can(OrgRole.Viewer, Permission.OrgRead);
            var managerCanApprove = PermissionMatrix.Can(OrgRole.Manager, Permission.WorklogsApproveOrg);
            var devCanApprove = PermissionMatrix.Can(OrgRole.Developer, Permission.WorklogsApproveOrg);
            var techLeadCanSeeSquadGl = PermissionMatrix.Can(OrgRole.TechLead, Permission.GitlabSeeSquad);
            var devCanSeeSquadGl = PermissionMatrix.Can(OrgRole.Developer, Permission.GitlabSeeSquad);

            var expected = new[] {
                (ownerCanDelete,        true,  "owner can OrgDelete"),
                (viewerCanDelete,       false, "viewer cannot OrgDelete"),
                (viewerCanRead,         true,  "viewer can OrgRead"),
                (managerCanApprove,     true,  "manager can WorklogsApproveOrg"),
                (devCanApprove,         false, "developer cannot WorklogsApproveOrg"),
                (techLeadCanSeeSquadGl, true,  "tech_lead can GitlabSeeSquad"),
                (devCanSeeSquadGl,      false, "developer cannot GitlabSeeSquad"),
            };
            var failures = expected.Where(t => t.Item1 != t.Item2).Select(t => t.Item3).ToList();
            if (failures.Count > 0) {
                throw new Exception("Matrix mismatch: " + string.Join("; ", failures));
            }
            results.Add(new { test = "rbac", ok = true });
        } catch (Exception ex) {
            allOk = false;
            results.Add(new { test = "rbac", ok = false, error = ex.Message });
        }

        return Results.Json(new { ok = allOk, results }, statusCode: allOk ? 200 : 500);
    }
}
