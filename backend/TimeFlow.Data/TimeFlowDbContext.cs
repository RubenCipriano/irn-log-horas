using Microsoft.EntityFrameworkCore;
using TimeFlow.Data.Models;

namespace TimeFlow.Data;

// Single DbContext for the application schema. Hangfire's tables live in
// its own schema (`hangfire.*`) and are NOT mapped here — keeping the
// concerns separate means we don't accidentally generate EF migrations
// that fight with Hangfire's own migrator.
//
// Schema philosophy:
//   * snake_case table + column names (Postgres convention).
//   * `Id` columns are UUID v4 generated client-side (Guid.NewGuid()) so
//     inserts don't need a round-trip for a returning value.
//   * `created_at` / `updated_at` are UTC on every row.
public sealed class TimeFlowDbContext : DbContext
{
    public TimeFlowDbContext(DbContextOptions<TimeFlowDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<UserTwoFactor> UserTwoFactors => Set<UserTwoFactor>();
    public DbSet<Organisation> Organisations => Set<Organisation>();
    public DbSet<OrgMembership> OrgMemberships => Set<OrgMembership>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<NativeProject> NativeProjects => Set<NativeProject>();
    public DbSet<NativeTask> NativeTasks => Set<NativeTask>();
    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();
    public DbSet<Worklog> Worklogs => Set<Worklog>();
    public DbSet<LeaveType> LeaveTypes => Set<LeaveType>();
    public DbSet<HourType> HourTypes => Set<HourType>();
    public DbSet<IntegrationConnection> IntegrationConnections => Set<IntegrationConnection>();
    public DbSet<IntegrationSyncJob> IntegrationSyncJobs => Set<IntegrationSyncJob>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<InvoiceLineWorklog> InvoiceLineWorklogs => Set<InvoiceLineWorklog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Email).HasColumnName("email").IsRequired().HasMaxLength(320);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(120);
            e.Property(x => x.PasswordHash).HasColumnName("password_hash");
            e.Property(x => x.EmailVerifiedAt).HasColumnName("email_verified_at");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            // Case-insensitive uniqueness via lowercase storage + unique
            // index. We normalise to lowercase at the service layer.
            e.HasIndex(x => x.Email).IsUnique().HasDatabaseName("ix_users_email_unique");

            e.HasOne(x => x.TwoFactor)
                .WithOne(x => x.User!)
                .HasForeignKey<UserTwoFactor>(x => x.UserId);
        });

        b.Entity<UserTwoFactor>(e =>
        {
            e.ToTable("user_two_factor");
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).HasColumnName("user_id");
            e.Property(x => x.Secret).HasColumnName("secret").IsRequired().HasMaxLength(64);
            e.Property(x => x.BackupCodesJson).HasColumnName("backup_codes").HasColumnType("text").IsRequired();
            e.Property(x => x.EnabledAt).HasColumnName("enabled_at");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        });

        b.Entity<Organisation>(e =>
        {
            e.ToTable("organisations");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Name).HasColumnName("name").IsRequired().HasMaxLength(120);
            e.Property(x => x.OwnerId).HasColumnName("owner_id");
            e.Property(x => x.ScheduleConfigJson).HasColumnName("schedule_config").HasColumnType("text");
            e.Property(x => x.HolidayProfileJson).HasColumnName("holiday_profile").HasColumnType("text");
            e.Property(x => x.Currency).HasColumnName("currency").IsRequired().HasMaxLength(3).HasDefaultValue("EUR");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            // Owner FK — SET NULL so a GDPR user-delete doesn't DB-block
            // the org row. The sole-owner 409 guard lives in the account-
            // delete handler (OrgMembership role=Owner check), not here.
            e.HasOne(x => x.Owner)
                .WithMany()
                .HasForeignKey(x => x.OwnerId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<OrgMembership>(e =>
        {
            // CHECK constraint on pay_cadence is the safety net for the
            // "hourly | daily | monthly" enum: NULL is also allowed and is
            // the backwards-compat sentinel meaning "hourly".
            e.ToTable("org_memberships", t => t.HasCheckConstraint(
                "ck_org_memberships_pay_cadence",
                "pay_cadence IS NULL OR pay_cadence IN ('hourly','daily','monthly')"));
            e.HasKey(x => new { x.UserId, x.OrgId });
            e.Property(x => x.UserId).HasColumnName("user_id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.Role).HasColumnName("role").IsRequired().HasMaxLength(20);
            e.Property(x => x.CostPerHour).HasColumnName("cost_per_hour").HasColumnType("numeric(10,2)");
            e.Property(x => x.PayCadence).HasColumnName("pay_cadence").HasMaxLength(16);
            e.Property(x => x.DailyRate).HasColumnName("daily_rate").HasColumnType("numeric(10,2)");
            e.Property(x => x.MonthlyRate).HasColumnName("monthly_rate").HasColumnType("numeric(10,2)");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            // User deleted → membership gone. Org deleted → memberships gone.
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Org)
                .WithMany(o => o.Memberships)
                .HasForeignKey(x => x.OrgId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(x => x.OrgId).HasDatabaseName("ix_org_memberships_org_id");
        });

        b.Entity<AuditLog>(e =>
        {
            e.ToTable("audit_log");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.ActorId).HasColumnName("actor_id");
            e.Property(x => x.Action).HasColumnName("action").IsRequired().HasMaxLength(80);
            e.Property(x => x.TargetType).HasColumnName("target_type").HasMaxLength(40);
            e.Property(x => x.TargetId).HasColumnName("target_id").HasMaxLength(80);
            e.Property(x => x.PayloadJson).HasColumnName("payload").HasColumnType("text").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");

            // ActorId SET NULL on user delete — preserves the audit row
            // for compliance reporting even after a GDPR right-to-erasure.
            // No nav property; EF infers the FK from HasForeignKey alone.
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.ActorId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(x => new { x.OrgId, x.CreatedAt }).HasDatabaseName("ix_audit_log_org_created");
            e.HasIndex(x => x.ActorId).HasDatabaseName("ix_audit_log_actor");
        });

        b.Entity<NativeProject>(e => {
            e.ToTable("native_projects");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.Name).HasColumnName("name").IsRequired().HasMaxLength(160);
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(40);
            e.Property(x => x.Archived).HasColumnName("archived");
            e.Property(x => x.CreatedBy).HasColumnName("created_by");
            e.Property(x => x.BillRate).HasColumnName("bill_rate").HasColumnType("numeric(10,2)");
            // Billing-party fields (collapsed from Client). Manager+ edits
            // them; the rate fallback at invoice time reads DefaultBillRate.
            e.Property(x => x.ContactEmail).HasColumnName("contact_email").HasMaxLength(200);
            e.Property(x => x.ContactName).HasColumnName("contact_name").HasMaxLength(200);
            e.Property(x => x.TaxId).HasColumnName("tax_id").HasMaxLength(60);
            e.Property(x => x.Address).HasColumnName("address").HasColumnType("text");
            e.Property(x => x.DefaultBillRate).HasColumnName("default_bill_rate").HasColumnType("numeric(10,2)");
            // Phase A — hierarchy + upstream mirror fields per spec §I.
            e.Property(x => x.ParentProjectId).HasColumnName("parent_project_id");
            e.Property(x => x.Type).HasColumnName("type").IsRequired().HasMaxLength(40).HasDefaultValue("project");
            e.Property(x => x.ConnectionId).HasColumnName("connection_id");
            e.Property(x => x.UpstreamProjectId).HasColumnName("upstream_project_id").HasMaxLength(120);
            e.Property(x => x.UpstreamRawJson).HasColumnName("upstream_raw_json").HasColumnType("text");
            e.Property(x => x.LastSyncedAt).HasColumnName("last_synced_at");
            e.Property(x => x.UpstreamUpdatedAt).HasColumnName("upstream_updated_at");
            // Per-project policy overrides — same JSON shapes as on
            // organisations. NULL = inherit from ancestor / org / default.
            e.Property(x => x.ScheduleConfig).HasColumnName("schedule_config").HasColumnType("text");
            e.Property(x => x.HolidayProfile).HasColumnName("holiday_profile").HasColumnType("text");
            // ISO-3166-1 alpha-2 shortcut for the holiday preset (PT/ES/FR/...).
            e.Property(x => x.HolidayCountry).HasColumnName("holiday_country").HasColumnType("varchar(2)").HasMaxLength(2);
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            e.HasOne(x => x.Org)
                .WithMany()
                .HasForeignKey(x => x.OrgId)
                .OnDelete(DeleteBehavior.Cascade);
            // CreatedBy SET NULL on user delete — project history survives,
            // identity is anonymised.
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);
            // Parent FK is CASCADE per spec §I5 — but app-level checks
            // refuse the hard delete first whenever any descendant has
            // worklogs, so the CASCADE is purely a safety net.
            e.HasOne(x => x.ParentProject)
                .WithMany()
                .HasForeignKey(x => x.ParentProjectId)
                .OnDelete(DeleteBehavior.Cascade);
            // Connection FK SET NULL — a connection drop demotes mirrored
            // rows to plain native rows (the user can re-attach later).
            e.HasOne(x => x.Connection)
                .WithMany()
                .HasForeignKey(x => x.ConnectionId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(x => x.OrgId).HasDatabaseName("ix_native_projects_org");
            // Code is unique per org when set (Postgres treats NULLs as
            // distinct in unique indexes, so multiple null codes are OK).
            e.HasIndex(x => new { x.OrgId, x.Code }).IsUnique().HasDatabaseName("ix_native_projects_org_code_unique");
            // Hot queries: "children of P" and "upstream mirror lookup".
            e.HasIndex(x => new { x.OrgId, x.ParentProjectId }).HasDatabaseName("ix_native_projects_org_parent");
            e.HasIndex(x => new { x.ConnectionId, x.UpstreamProjectId })
                .IsUnique()
                .HasFilter("connection_id IS NOT NULL")
                .HasDatabaseName("ix_native_projects_connection_upstream_unique");
        });

        b.Entity<NativeTask>(e => {
            e.ToTable("native_tasks");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.ProjectId).HasColumnName("project_id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.Title).HasColumnName("title").IsRequired().HasMaxLength(200);
            e.Property(x => x.Description).HasColumnName("description");
            e.Property(x => x.Status).HasColumnName("status").IsRequired().HasMaxLength(40);
            e.Property(x => x.AssigneeId).HasColumnName("assignee_id");
            e.Property(x => x.CreatedBy).HasColumnName("created_by");
            // Phase A — upstream mirror fields absorbed from upstream_tasks.
            e.Property(x => x.ConnectionId).HasColumnName("connection_id");
            e.Property(x => x.UpstreamTaskId).HasColumnName("upstream_task_id").HasMaxLength(120);
            e.Property(x => x.UpstreamVersionId).HasColumnName("upstream_version_id").HasMaxLength(120);
            e.Property(x => x.UpstreamVersionName).HasColumnName("upstream_version_name").HasMaxLength(200);
            e.Property(x => x.UpstreamUpdatedAt).HasColumnName("upstream_updated_at");
            e.Property(x => x.AssigneeUpstreamId).HasColumnName("assignee_upstream_id").HasMaxLength(120);
            e.Property(x => x.UpstreamRawJson).HasColumnName("upstream_raw_json").HasColumnType("text");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            e.HasOne(x => x.Project)
                .WithMany(p => p.Tasks)
                .HasForeignKey(x => x.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Connection)
                .WithMany()
                .HasForeignKey(x => x.ConnectionId)
                .OnDelete(DeleteBehavior.SetNull);
            // AssigneeId and CreatedBy SET NULL on user delete — task history
            // survives, identity is anonymised.
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.AssigneeId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(x => x.ProjectId).HasDatabaseName("ix_native_tasks_project");
            e.HasIndex(x => new { x.OrgId, x.Status }).HasDatabaseName("ix_native_tasks_org_status");
            e.HasIndex(x => new { x.ConnectionId, x.UpstreamTaskId })
                .IsUnique()
                .HasFilter("connection_id IS NOT NULL")
                .HasDatabaseName("ix_native_tasks_connection_upstream_unique");
        });

        b.Entity<ProjectMember>(e => {
            e.ToTable("project_members");
            // Composite PK — a member is either allocated to a project or not.
            e.HasKey(x => new { x.ProjectId, x.UserId });
            e.Property(x => x.ProjectId).HasColumnName("project_id");
            e.Property(x => x.UserId).HasColumnName("user_id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.CostPerHour).HasColumnName("cost_per_hour").HasColumnType("numeric(10,2)");
            // Phase A — hierarchy-aware role + deny per spec §I1/I2/I9.
            e.Property(x => x.RoleOnProject).HasColumnName("role_on_project").IsRequired().HasMaxLength(40).HasDefaultValue("developer");
            e.Property(x => x.Denied).HasColumnName("denied").HasDefaultValue(false);
            e.Property(x => x.AllocatedAt).HasColumnName("allocated_at");
            e.Property(x => x.AllocatedBy).HasColumnName("allocated_by");

            // Project deleted → allocation gone. User deleted → allocation
            // gone (GDPR cascade; their cost data was scoped per-user).
            e.HasOne(x => x.Project)
                .WithMany()
                .HasForeignKey(x => x.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            // AllocatedBy SET NULL on user delete — allocation record stays;
            // who granted it is anonymised.
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.AllocatedBy)
                .OnDelete(DeleteBehavior.SetNull);

            // Reverse lookup: "what projects is this user allocated to?"
            e.HasIndex(x => new { x.UserId, x.ProjectId }).HasDatabaseName("ix_project_members_user_project");
            e.HasIndex(x => x.OrgId).HasDatabaseName("ix_project_members_org");
        });

        b.Entity<Worklog>(e => {
            e.ToTable("worklogs");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.UserId).HasColumnName("user_id");
            e.Property(x => x.ProjectId).HasColumnName("project_id");
            e.Property(x => x.TaskId).HasColumnName("task_id");
            e.Property(x => x.WorkDate).HasColumnName("work_date");
            e.Property(x => x.Hours).HasColumnName("hours").HasColumnType("numeric(5,2)");
            e.Property(x => x.Notes).HasColumnName("notes");
            e.Property(x => x.Source).HasColumnName("source").HasMaxLength(40);
            e.Property(x => x.PushStatus).HasColumnName("push_status").IsRequired().HasMaxLength(20);
            e.Property(x => x.UpstreamWorklogId).HasColumnName("upstream_worklog_id").HasMaxLength(120);
            e.Property(x => x.PushErrorCode).HasColumnName("push_error_code").HasMaxLength(20);
            e.Property(x => x.IsBillable).HasColumnName("is_billable").HasDefaultValue(true);
            e.Property(x => x.InvoiceLineId).HasColumnName("invoice_line_id");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            // FKs deliberately NOT set up as nav properties — Worklog
            // doesn't navigate to Project/Task to keep loads cheap.
            // EF still emits the FK constraints from the column types
            // when we add them explicitly below.
            // Was Restrict (blocked project delete with logs); switched to
            // SetNull so a manager can delete a project — worklogs survive
            // as project-less rows (already a valid state for upstream
            // worklogs).
            e.HasOne<NativeProject>()
                .WithMany()
                .HasForeignKey(x => x.ProjectId)
                .OnDelete(DeleteBehavior.SetNull);
            // SET NULL — voiding an invoice or removing a line frees the
            // worklog for re-invoicing.
            e.HasOne<InvoiceLine>()
                .WithMany()
                .HasForeignKey(x => x.InvoiceLineId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne<NativeTask>()
                .WithMany()
                .HasForeignKey(x => x.TaskId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // The hot query is "give me this user's logs for this week" —
            // index supports it directly.
            e.HasIndex(x => new { x.UserId, x.WorkDate }).HasDatabaseName("ix_worklogs_user_date");
            e.HasIndex(x => new { x.OrgId, x.WorkDate }).HasDatabaseName("ix_worklogs_org_date");
            // Push job poll: "give me pending pushes" — small partial-ish set.
            e.HasIndex(x => x.PushStatus).HasDatabaseName("ix_worklogs_push_status");
        });

        b.Entity<LeaveType>(e => {
            e.ToTable("leave_types");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.Name).HasColumnName("name").IsRequired().HasMaxLength(80);
            e.Property(x => x.Paid).HasColumnName("paid");
            e.Property(x => x.DefaultHours).HasColumnName("default_hours").HasColumnType("numeric(5,2)");
            e.Property(x => x.Color).HasColumnName("color").HasMaxLength(20);
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasIndex(x => new { x.OrgId, x.Name }).IsUnique().HasDatabaseName("ix_leave_types_org_name_unique");
        });

        b.Entity<HourType>(e => {
            e.ToTable("hour_types");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.Name).HasColumnName("name").IsRequired().HasMaxLength(80);
            e.Property(x => x.Billable).HasColumnName("billable");
            e.Property(x => x.Color).HasColumnName("color").HasMaxLength(20);
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasIndex(x => new { x.OrgId, x.Name }).IsUnique().HasDatabaseName("ix_hour_types_org_name_unique");
        });

        b.Entity<IntegrationConnection>(e => {
            e.ToTable("integration_connections");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.Provider).HasColumnName("provider").IsRequired().HasMaxLength(40);
            e.Property(x => x.Name).HasColumnName("name").IsRequired().HasMaxLength(120);
            e.Property(x => x.EncryptedCredentials).HasColumnName("encrypted_credentials").IsRequired().HasColumnType("text");
            e.Property(x => x.UpstreamUserId).HasColumnName("upstream_user_id").HasMaxLength(120);
            e.Property(x => x.UpstreamUserName).HasColumnName("upstream_user_name").HasMaxLength(160);
            e.Property(x => x.LastVerifiedAt).HasColumnName("last_verified_at");
            e.Property(x => x.LastVerifyError).HasColumnName("last_verify_error").HasMaxLength(40);
            e.Property(x => x.CreatedBy).HasColumnName("created_by");
            // Ownership tuple — one row per (project, user, provider).
            e.Property(x => x.ProjectId).HasColumnName("project_id").IsRequired();
            e.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            e.HasOne(x => x.Org)
                .WithMany()
                .HasForeignKey(x => x.OrgId)
                .OnDelete(DeleteBehavior.Cascade);
            // CreatedBy SET NULL on user delete — connection history survives,
            // identity is anonymised.
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);
            // Cascade on project delete — when the engagement goes, the
            // member's credential is meaningless. Mirrored sub-projects /
            // tasks under it cascade through their own connection_id FK.
            e.HasOne(x => x.Project)
                .WithMany()
                .HasForeignKey(x => x.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);
            // Cascade on user delete — GDPR: their credential vanishes
            // with them. Same shape as org_memberships.
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // Unique label per (org, provider) so the picker isn't ambiguous.
            e.HasIndex(x => new { x.OrgId, x.Provider, x.Name }).IsUnique()
                .HasDatabaseName("ix_integration_connections_org_provider_name_unique");
            // One member, one project, one provider, one connection.
            e.HasIndex(x => new { x.ProjectId, x.UserId, x.Provider }).IsUnique()
                .HasDatabaseName("ix_integration_connections_project_user_provider_unique");
        });

        b.Entity<IntegrationSyncJob>(e => {
            e.ToTable("integration_sync_jobs");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.ConnectionId).HasColumnName("connection_id");
            e.Property(x => x.Kind).HasColumnName("kind").IsRequired().HasMaxLength(40);
            e.Property(x => x.Status).HasColumnName("status").IsRequired().HasMaxLength(20);
            e.Property(x => x.ProgressTotal).HasColumnName("progress_total");
            e.Property(x => x.ProgressDone).HasColumnName("progress_done");
            e.Property(x => x.CancelRequested).HasColumnName("cancel_requested");
            e.Property(x => x.FullResync).HasColumnName("full_resync").HasDefaultValue(false);
            e.Property(x => x.ErrorCode).HasColumnName("error_code").HasMaxLength(20);
            e.Property(x => x.ErrorMessage).HasColumnName("error_message");
            e.Property(x => x.SummaryJson).HasColumnName("summary").HasColumnType("text");
            e.Property(x => x.StartedBy).HasColumnName("started_by");
            e.Property(x => x.StartedAt).HasColumnName("started_at");
            e.Property(x => x.FinishedAt).HasColumnName("finished_at");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");

            e.HasOne<IntegrationConnection>()
                .WithMany()
                .HasForeignKey(x => x.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
            // StartedBy SET NULL on user delete — sync-job audit trail
            // survives, initiator identity is anonymised.
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.StartedBy)
                .OnDelete(DeleteBehavior.SetNull);

            // Hot query: "give me this connection's recent jobs newest-first".
            e.HasIndex(x => new { x.ConnectionId, x.CreatedAt }).HasDatabaseName("ix_sync_jobs_connection_created");
            e.HasIndex(x => new { x.OrgId, x.Status }).HasDatabaseName("ix_sync_jobs_org_status");
        });

        b.Entity<Invoice>(e => {
            e.ToTable("invoices");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.OrgId).HasColumnName("org_id");
            e.Property(x => x.ProjectId).HasColumnName("project_id");
            e.Property(x => x.BilledPartyName).HasColumnName("billed_party_name").HasMaxLength(200);
            e.Property(x => x.Number).HasColumnName("number").IsRequired().HasMaxLength(40);
            e.Property(x => x.PeriodFrom).HasColumnName("period_from");
            e.Property(x => x.PeriodTo).HasColumnName("period_to");
            e.Property(x => x.Status).HasColumnName("status").IsRequired().HasMaxLength(20);
            e.Property(x => x.Subtotal).HasColumnName("subtotal").HasColumnType("numeric(12,2)");
            e.Property(x => x.TaxPct).HasColumnName("tax_pct").HasColumnType("numeric(5,2)");
            e.Property(x => x.TaxAmount).HasColumnName("tax_amount").HasColumnType("numeric(12,2)");
            e.Property(x => x.Total).HasColumnName("total").HasColumnType("numeric(12,2)");
            e.Property(x => x.Currency).HasColumnName("currency").IsRequired().HasMaxLength(3);
            e.Property(x => x.Notes).HasColumnName("notes").HasColumnType("text");
            e.Property(x => x.IssuedAt).HasColumnName("issued_at");
            e.Property(x => x.DueAt).HasColumnName("due_at");
            e.Property(x => x.PaidAt).HasColumnName("paid_at");
            e.Property(x => x.CreatedBy).HasColumnName("created_by");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            e.HasOne<Organisation>()
                .WithMany()
                .HasForeignKey(x => x.OrgId)
                .OnDelete(DeleteBehavior.Cascade);
            // RESTRICT — a project with non-void invoices can't be deleted
            // (the accounting record must survive).
            e.HasOne(x => x.Project)
                .WithMany()
                .HasForeignKey(x => x.ProjectId)
                .OnDelete(DeleteBehavior.Restrict);
            // CreatedBy SET NULL on user delete — invoice record stays;
            // who generated it is anonymised.
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(x => new { x.OrgId, x.Status }).HasDatabaseName("ix_invoices_org_status");
            e.HasIndex(x => new { x.OrgId, x.ProjectId }).HasDatabaseName("ix_invoices_org_project");
            e.HasIndex(x => new { x.OrgId, x.Number }).IsUnique().HasDatabaseName("ix_invoices_org_number_unique");
        });

        b.Entity<InvoiceLine>(e => {
            e.ToTable("invoice_lines");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.InvoiceId).HasColumnName("invoice_id");
            e.Property(x => x.WorklogId).HasColumnName("worklog_id");
            e.Property(x => x.Description).HasColumnName("description").IsRequired().HasMaxLength(400);
            e.Property(x => x.Hours).HasColumnName("hours").HasColumnType("numeric(6,2)");
            e.Property(x => x.BillRate).HasColumnName("bill_rate").HasColumnType("numeric(10,2)");
            e.Property(x => x.Amount).HasColumnName("amount").HasColumnType("numeric(12,2)");
            e.Property(x => x.Ordinal).HasColumnName("ordinal");
            // Cadence-aware fields. The columns are added NULLABLE by
            // AddInvoiceLineCadence and backfilled to the hourly defaults
            // (quantity=hours, quantity_unit='hours', cadence='hourly') in
            // the same migration. A follow-up TightenInvoiceLineCadence
            // migration is owed to SET NOT NULL + add the value-set CHECK
            // constraints (per CLAUDE.md's NOT NULL multi-step ceremony).
            e.Property(x => x.Quantity).HasColumnName("quantity").HasColumnType("numeric(10,4)");
            e.Property(x => x.QuantityUnit).HasColumnName("quantity_unit").HasMaxLength(16);
            e.Property(x => x.Cadence).HasColumnName("cadence").HasMaxLength(16);

            e.HasOne(x => x.Invoice)
                .WithMany(i => i.Lines)
                .HasForeignKey(x => x.InvoiceId)
                .OnDelete(DeleteBehavior.Cascade);
            // SET NULL — line survives a worklog delete (audit trail).
            e.HasOne<Worklog>()
                .WithMany()
                .HasForeignKey(x => x.WorklogId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(x => new { x.InvoiceId, x.Ordinal }).HasDatabaseName("ix_invoice_lines_invoice_ordinal");
        });

        b.Entity<InvoiceLineWorklog>(e => {
            e.ToTable("invoice_line_worklogs");
            e.HasKey(x => new { x.InvoiceLineId, x.WorklogId })
                .HasName("pk_invoice_line_worklogs");
            e.Property(x => x.InvoiceLineId).HasColumnName("invoice_line_id");
            e.Property(x => x.WorklogId).HasColumnName("worklog_id");

            e.HasOne(x => x.InvoiceLine)
                .WithMany()
                .HasForeignKey(x => x.InvoiceLineId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_invoice_line_worklogs_invoice_line");

            e.HasOne(x => x.Worklog)
                .WithMany()
                .HasForeignKey(x => x.WorklogId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_invoice_line_worklogs_worklog");

            e.HasIndex(x => x.InvoiceLineId)
                .HasDatabaseName("ix_invoice_line_worklogs_line");
            e.HasIndex(x => x.WorklogId)
                .IsUnique()
                .HasDatabaseName("ix_invoice_line_worklogs_worklog_unique");
        });
    }
}
