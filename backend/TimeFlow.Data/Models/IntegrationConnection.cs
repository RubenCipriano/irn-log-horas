namespace TimeFlow.Data.Models;

// A stored upstream connection. One row per (project, user, provider)
// — i.e. a member's personal credential for a specific engagement on a
// specific tracker. Credentials are AES-256-GCM encrypted via
// TimeFlow.Vault with context=`integration:{Id}` so a hostile admin who
// can move rows between orgs can't decrypt them (wrong context → AEAD
// tag fails).
//
// `LastVerifiedAt` is touched whenever /verify succeeds; the UI shows
// "last checked Xh ago" so users can tell stale credentials apart from
// actively-failing ones without leaving the connections page.
public sealed class IntegrationConnection {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrgId { get; set; }

    /// <summary>Provider key — `openproject` | `jira` | `linear` | `gitlab`.</summary>
    public string Provider { get; set; } = string.Empty;

    /// <summary>Human label shown in the picker. Unique per (org, provider).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Base64 envelope (see TimeFlow.Vault.VaultEnvelope).</summary>
    public string EncryptedCredentials { get; set; } = string.Empty;

    /// <summary>Upstream user id captured at create-time — drift sentinel.</summary>
    public string? UpstreamUserId { get; set; }
    public string? UpstreamUserName { get; set; }

    public DateTime? LastVerifiedAt { get; set; }
    public string? LastVerifyError { get; set; } // bucketed; never raw upstream body

    /// <summary>SET NULL on user delete (audit-anonymisation rule).</summary>
    public Guid? CreatedBy { get; set; }

    /// <summary>
    /// The engagement project this connection belongs to. Mirrored
    /// upstream sub-projects get `parent_project_id = this` so the owner
    /// can trace which (project, member) brought them in.
    /// </summary>
    public Guid ProjectId { get; set; }

    /// <summary>
    /// The member who owns this connection. Together with ProjectId +
    /// Provider this forms the UNIQUE key — one member, one project, one
    /// provider, one connection.
    /// </summary>
    public Guid UserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Organisation? Org { get; set; }
    public NativeProject? Project { get; set; }
    public User? User { get; set; }
}
