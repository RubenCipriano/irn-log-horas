namespace TimeFlow.Data.Models;

// One billable line on an invoice. Almost always backed by a Worklog
// (and the worklog's `InvoiceLineId` points back), but `WorklogId` is
// nullable so a manual line item can exist (e.g. "Travel reimbursement
// 250.00" with no hours backing).
//
// Quantity + QuantityUnit + Cadence model the cadence-aware emit (see
// InvoiceEndpoints.GatherCandidateLinesAsync):
//
//   * hourly  line: Quantity = Hours = worklog.Hours; QuantityUnit = 'hours';
//                   Cadence = 'hourly'.   Amount = round(Quantity * BillRate, 2).
//   * daily   line: Quantity = distinct workdays; QuantityUnit = 'days';
//                   Cadence = 'daily'.   Hours carries the underlying logged
//                   hours for audit; Amount = Quantity * BillRate.
//   * monthly line: Quantity = proration ratio clamped [0,1]; QuantityUnit = 'months';
//                   Cadence = 'monthly'. Hours carries the underlying logged
//                   hours; Amount = Quantity * BillRate.
//
// Hours stays the source of truth for hourly cadence and carries logged-
// hours as audit info on rollup rows so historical PDFs keep working.
public sealed class InvoiceLine {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InvoiceId { get; set; }

    /// <summary>SET NULL when the source worklog is deleted; line survives.
    /// Rollup lines (daily/monthly) leave this null and instead enumerate
    /// their backing worklogs through invoice_line_worklogs.</summary>
    public Guid? WorklogId { get; set; }

    public string Description { get; set; } = string.Empty;

    public decimal Hours { get; set; }
    public decimal BillRate { get; set; }
    public decimal Amount { get; set; }

    /// <summary>
    /// Canonical "how many units of <see cref="QuantityUnit"/>" this line bills.
    /// Mirrors Hours for hourly cadence; distinct workdays for daily; pro-ration
    /// ratio in [0,1] for monthly.
    /// </summary>
    public decimal Quantity { get; set; }

    /// <summary>'hours' | 'days' | 'months'.</summary>
    public string QuantityUnit { get; set; } = "hours";

    /// <summary>'hourly' | 'daily' | 'monthly'. Denormalised from the
    /// org_membership.pay_cadence at generation time so read paths don't
    /// need to re-resolve cadence and so post-generation cadence flips
    /// don't rewrite history.</summary>
    public string Cadence { get; set; } = "hourly";

    /// <summary>Display order — small int, monotonically increasing per invoice.</summary>
    public int Ordinal { get; set; }

    public Invoice? Invoice { get; set; }
}
