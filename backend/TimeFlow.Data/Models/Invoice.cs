namespace TimeFlow.Data.Models;

// One invoice issued from the org against a project (the engagement IS
// the invoiced party — Client was collapsed into NativeProject). Generated
// from billable worklogs over a period by `POST /invoices/generate`.
// Status flow:
//   draft → sent → paid     (happy path)
//   * → void                (kill switch — re-opens worklogs for re-bill)
//
// `Number` is sequential per (OrgId, year), formatted `INV-{YYYY}-{NNNN}`.
// Generation grabs an advisory lock + max-number bump in one transaction.
//
// `BilledPartyName` is the project's display name (or contact name when
// set) captured at generation time so historical PDFs survive a project
// rename. Without this snapshot, re-rendering a year-old invoice would
// print the project's current name — which the customer never saw.
//
// Totals are pre-computed at generation time so list views don't have to
// sum lines on every read. Recomputed on tax_pct change while draft.
public sealed class Invoice {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrgId { get; set; }

    /// <summary>RESTRICT — can't delete a project with non-void invoices.</summary>
    public Guid ProjectId { get; set; }

    /// <summary>
    /// Snapshot of the billed-party display name at generation time. Survives
    /// project renames so reprinted PDFs match what the customer originally
    /// received. Null only for legacy rows from pre-collapse migration.
    /// </summary>
    public string? BilledPartyName { get; set; }

    public string Number { get; set; } = string.Empty;

    public DateOnly PeriodFrom { get; set; }
    public DateOnly PeriodTo { get; set; }

    /// <summary>"draft" | "sent" | "paid" | "void".</summary>
    public string Status { get; set; } = "draft";

    public decimal Subtotal { get; set; }
    public decimal TaxPct { get; set; }
    public decimal TaxAmount { get; set; }
    public decimal Total { get; set; }

    /// <summary>ISO 4217 currency code captured from the org at generation time.</summary>
    public string Currency { get; set; } = "EUR";

    public string? Notes { get; set; }

    /// <summary>Wall-clock when the invoice flipped from draft → sent.</summary>
    public DateTime? IssuedAt { get; set; }
    public DateOnly? DueAt { get; set; }

    /// <summary>Set when status flips to paid.</summary>
    public DateTime? PaidAt { get; set; }

    /// <summary>SET NULL on user delete.</summary>
    public Guid? CreatedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public NativeProject? Project { get; set; }
    public ICollection<InvoiceLine> Lines { get; set; } = new List<InvoiceLine>();
}
