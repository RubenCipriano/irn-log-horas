namespace TimeFlow.Billing;

// Self-contained payload — the caller maps from EF models / API DTOs into
// these records so TimeFlow.Billing doesn't need a project reference to
// TimeFlow.Data or TimeFlow.Api (keeps the dependency tree shallow).
public sealed record InvoicePayload(
    string Number,
    string Currency,
    DateOnly PeriodFrom,
    DateOnly PeriodTo,
    DateTime? IssuedAt,
    DateOnly? DueAt,
    string? Notes,
    decimal Subtotal,
    decimal TaxPct,
    decimal TaxAmount,
    decimal Total,
    OrgPayload Org,
    ClientPayload Client,
    IReadOnlyList<InvoiceLinePayload> Lines);

public sealed record OrgPayload(string Name);

public sealed record ClientPayload(
    string Name,
    string? ContactName,
    string? ContactEmail,
    string? TaxId,
    string? Address);

// Quantity + Unit drive the per-row "Q x rate /unit" rendering. Hours
// stays on the payload for backwards compatibility and for the daily/monthly
// rollup audit field (it carries the underlying logged hours even though
// the amount math runs through Quantity * BillRate).
public sealed record InvoiceLinePayload(
    string Description,
    decimal Hours,
    decimal BillRate,
    decimal Amount,
    decimal Quantity,
    string QuantityUnit);

public interface IInvoicePdfRenderer {
    byte[] Render(InvoicePayload payload);
}
