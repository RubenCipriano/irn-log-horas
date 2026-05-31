using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace TimeFlow.Rbac;

// Minimal-API endpoint filter that enforces a permission within an org
// whose id is on the route (URL > body > query is the CLAUDE.md rule,
// but for this filter we ONLY read from the route — body-scoped orgIds
// belong on bespoke checks because they may be batch operations).
//
// 401 (no principal), 404 (not a member of the org), 403 (member but
// role too low). 404 instead of 403 for non-members is intentional:
// matches the legacy `requireOrgRole` contract so we don't leak "this
// org exists" to attackers probing for tenant ids.
public sealed class RequireOrgPermissionFilter : IEndpointFilter {
    private readonly Permission _permission;
    private readonly string _routeKey;

    public RequireOrgPermissionFilter(Permission permission, string routeKey = "id") {
        _permission = permission;
        _routeKey = routeKey;
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next) {
        var http = ctx.HttpContext;

        // 401 — no authenticated identity. Authorization middleware should
        // already have rejected anonymous traffic via .RequireAuthorization(),
        // but this guards against accidental misconfiguration.
        var userId = ResolveUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        // The route MUST carry the org id — if it doesn't, the filter is
        // misapplied (likely attached to a non-org-scoped route).
        if (!http.Request.RouteValues.TryGetValue(_routeKey, out var raw)
            || raw is null
            || !Guid.TryParse(raw.ToString(), out var orgId)) {
            return Results.Problem(
                title: "Route missing org id.",
                detail: $"RequireOrgPermission expects route value '{_routeKey}' to be a GUID.",
                statusCode: 500);
        }

        var reader = http.RequestServices.GetRequiredService<IOrgMembershipReader>();
        var role = await reader.GetRoleAsync(userId.Value, orgId, http.RequestAborted);
        if (role is null) return Results.NotFound(new { error = "Org not found." });

        if (!PermissionMatrix.Can(role.Value, _permission)) {
            return Results.Json(new {
                error = "Forbidden.",
                role = role.Value.ToWire(),
                permission = _permission.ToWire(),
            }, statusCode: StatusCodes.Status403Forbidden);
        }

        // Stash the resolved role + orgId in HttpContext so endpoint
        // handlers can read them without re-querying.
        http.Items[OrgContextKeys.OrgId] = orgId;
        http.Items[OrgContextKeys.Role] = role.Value;
        return await next(ctx);
    }

    private static Guid? ResolveUserId(ClaimsPrincipal principal) {
        var sub = principal.FindFirstValue("sub")
            ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}

public static class OrgContextKeys {
    public const string OrgId = "tf.orgId";
    public const string Role = "tf.role";
}

public static class RequireOrgPermissionExtensions {
    /// <summary>
    /// Attach <see cref="RequireOrgPermissionFilter"/>. Defaults to reading the
    /// org id from route value `id` (the canonical URL is `/api/orgs/{id}/...`).
    /// </summary>
    public static TBuilder RequireOrgPermission<TBuilder>(this TBuilder builder, Permission permission, string routeKey = "id")
        where TBuilder : IEndpointConventionBuilder {
        builder.AddEndpointFilter(new RequireOrgPermissionFilter(permission, routeKey));
        return builder;
    }

    /// <summary>Get the resolved (orgId, role) pair stashed by the filter. Throws if absent.</summary>
    public static (Guid OrgId, OrgRole Role) RequireOrgContext(this HttpContext http) {
        if (http.Items[OrgContextKeys.OrgId] is not Guid orgId
            || http.Items[OrgContextKeys.Role] is not OrgRole role) {
            throw new InvalidOperationException("Org context not set. Did you forget .RequireOrgPermission(...)?");
        }
        return (orgId, role);
    }
}
