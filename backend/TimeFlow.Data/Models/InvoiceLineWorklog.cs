namespace TimeFlow.Data.Models;

// Maps worklog -> invoice_line for ROLLUP cadences (daily / monthly).
// A daily/monthly line aggregates N worklogs, so the existing scalar
// InvoiceLine.WorklogId cannot represent the set. Hourly lines DO NOT
// insert here — they keep the direct WorklogId pointer + worklog.invoice_line_id.
//
// Composite PK (invoice_line_id, worklog_id). Unique index on worklog_id
// keeps the invariant "a worklog can only be rolled into one invoice line."
public sealed class InvoiceLineWorklog {
    public Guid InvoiceLineId { get; set; }
    public Guid WorklogId { get; set; }

    public InvoiceLine? InvoiceLine { get; set; }
    public Worklog? Worklog { get; set; }
}
