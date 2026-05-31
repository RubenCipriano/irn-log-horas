using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace TimeFlow.Billing;

// QuestPDF-backed renderer. A4, single-column. Top: org header + invoice
// number block. Then: client block. Then: line table. Then: totals.
// Bottom: notes.
//
// Currency formatting uses culture-neutral en-US for the numeric portion
// with the bare currency code as a suffix — avoids locale surprises for
// freelancers issuing across borders.
public sealed class InvoicePdfRenderer : IInvoicePdfRenderer {
    public byte[] Render(InvoicePayload p) {
        var doc = Document.Create(c => c.Page(page => {
            page.Size(PageSizes.A4);
            page.Margin(40);
            page.PageColor(Colors.White);
            page.DefaultTextStyle(t => t.FontSize(10));

            page.Header().Row(row => {
                row.RelativeItem().Column(col => {
                    col.Item().Text(p.Org.Name).FontSize(16).Bold();
                    col.Item().Text("Invoice").FontSize(20).Bold().FontColor(Colors.Grey.Darken2);
                });
                row.ConstantItem(200).AlignRight().Column(col => {
                    col.Item().Text(p.Number).FontSize(14).Bold();
                    if (p.IssuedAt is DateTime issued) {
                        col.Item().Text($"Issued: {issued:yyyy-MM-dd}").FontColor(Colors.Grey.Darken1);
                    }
                    if (p.DueAt is DateOnly due) {
                        col.Item().Text($"Due: {due:yyyy-MM-dd}").FontColor(Colors.Grey.Darken1);
                    }
                    col.Item().Text($"Period: {p.PeriodFrom:yyyy-MM-dd} → {p.PeriodTo:yyyy-MM-dd}")
                        .FontColor(Colors.Grey.Darken1);
                });
            });

            page.Content().PaddingTop(20).Column(col => {
                col.Item().PaddingBottom(15).Column(c => {
                    c.Item().Text("Bill to").FontColor(Colors.Grey.Darken1).FontSize(9);
                    c.Item().Text(p.Client.Name).Bold().FontSize(12);
                    if (!string.IsNullOrWhiteSpace(p.Client.ContactName)) {
                        c.Item().Text(p.Client.ContactName!);
                    }
                    if (!string.IsNullOrWhiteSpace(p.Client.ContactEmail)) {
                        c.Item().Text(p.Client.ContactEmail!).FontColor(Colors.Grey.Darken1);
                    }
                    if (!string.IsNullOrWhiteSpace(p.Client.TaxId)) {
                        c.Item().Text($"Tax id: {p.Client.TaxId}").FontColor(Colors.Grey.Darken1);
                    }
                    if (!string.IsNullOrWhiteSpace(p.Client.Address)) {
                        c.Item().Text(p.Client.Address!).FontColor(Colors.Grey.Darken1);
                    }
                });

                col.Item().Table(t => {
                    t.ColumnsDefinition(cd => {
                        cd.RelativeColumn(5); // description
                        cd.RelativeColumn(1); // qty
                        cd.RelativeColumn(1); // rate
                        cd.RelativeColumn(1); // amount
                    });
                    t.Header(h => {
                        h.Cell().Element(HeaderCell).Text("Description");
                        // Mixed-unit invoices (rare but possible for member-target
                        // invoices spanning cadences) get a generic "Qty" header.
                        h.Cell().Element(HeaderCell).AlignRight().Text(QuantityHeader(p));
                        h.Cell().Element(HeaderCell).AlignRight().Text("Rate");
                        h.Cell().Element(HeaderCell).AlignRight().Text("Amount");
                    });
                    foreach (var line in p.Lines) {
                        t.Cell().Element(BodyCell).Text(line.Description);
                        t.Cell().Element(BodyCell).AlignRight().Text(
                            line.Quantity.ToString(QuantityFormat(line.QuantityUnit), CultureInfo.InvariantCulture));
                        t.Cell().Element(BodyCell).AlignRight().Text(line.BillRate.ToString("0.00", CultureInfo.InvariantCulture));
                        t.Cell().Element(BodyCell).AlignRight().Text(FormatMoney(line.Amount, p.Currency));
                    }
                });

                col.Item().PaddingTop(15).AlignRight().Width(220).Column(c => {
                    c.Item().Row(r => {
                        r.RelativeItem().Text("Subtotal").FontColor(Colors.Grey.Darken1);
                        r.ConstantItem(110).AlignRight().Text(FormatMoney(p.Subtotal, p.Currency));
                    });
                    if (p.TaxPct > 0m) {
                        c.Item().Row(r => {
                            r.RelativeItem().Text($"Tax ({p.TaxPct.ToString("0.##", CultureInfo.InvariantCulture)}%)")
                                .FontColor(Colors.Grey.Darken1);
                            r.ConstantItem(110).AlignRight().Text(FormatMoney(p.TaxAmount, p.Currency));
                        });
                    }
                    c.Item().BorderTop(1).BorderColor(Colors.Grey.Lighten2).PaddingTop(5).Row(r => {
                        r.RelativeItem().Text("Total").Bold();
                        r.ConstantItem(110).AlignRight().Text(FormatMoney(p.Total, p.Currency)).Bold();
                    });
                });

                if (!string.IsNullOrWhiteSpace(p.Notes)) {
                    col.Item().PaddingTop(30).Column(c => {
                        c.Item().Text("Notes").FontColor(Colors.Grey.Darken1).FontSize(9);
                        c.Item().Text(p.Notes!);
                    });
                }
            });

            page.Footer().AlignCenter().Text(t => {
                t.Span("Page ").FontColor(Colors.Grey.Darken1).FontSize(9);
                t.CurrentPageNumber().FontColor(Colors.Grey.Darken1).FontSize(9);
                t.Span(" of ").FontColor(Colors.Grey.Darken1).FontSize(9);
                t.TotalPages().FontColor(Colors.Grey.Darken1).FontSize(9);
            });
        }));
        return doc.GeneratePdf();
    }

    private static IContainer HeaderCell(IContainer container) =>
        container.DefaultTextStyle(t => t.SemiBold().FontColor(Colors.Grey.Darken2))
            .PaddingVertical(6).BorderBottom(1).BorderColor(Colors.Grey.Lighten2);

    private static IContainer BodyCell(IContainer container) =>
        container.PaddingVertical(4);

    private static string FormatMoney(decimal value, string currency) =>
        value.ToString("0.00", CultureInfo.InvariantCulture) + " " + currency;

    // When every line shares a unit, the column header doubles as the label.
    // Mixed-unit invoices (member-target spanning cadences) fall back to "Qty".
    private static string QuantityHeader(InvoicePayload p) {
        if (p.Lines.Count == 0) return "Qty";
        var first = p.Lines[0].QuantityUnit;
        foreach (var l in p.Lines) {
            if (!string.Equals(l.QuantityUnit, first, StringComparison.OrdinalIgnoreCase)) {
                return "Qty";
            }
        }
        return first switch {
            "hours" => "Hours",
            "days" => "Days",
            "months" => "Months",
            _ => "Qty",
        };
    }

    // Months pro-rate as fractional values (0.5417 of a month); hours/days
    // bill in 2 decimals to match the existing PDF style.
    private static string QuantityFormat(string unit) =>
        string.Equals(unit, "months", StringComparison.OrdinalIgnoreCase) ? "0.0000" : "0.00";
}
