namespace TimeFlow.Domain.Holidays;

// Built-in regional holiday rule sets. Phase 6 ships Portugal national
// only; Spain / UK / US / Brazil + regional Portugal variants land in
// later iterations (same shape, just more presets registered here).
public static class HolidayPresets {
    public const string DefaultKey = "portugal";

    /// <summary>Portugal national holidays — fixed + Easter-derived.</summary>
    public static readonly IReadOnlyList<HolidayRule> Portugal = new HolidayRule[] {
        new FixedDateHoliday("Ano Novo", "portugal", 1, 1),
        new EasterOffsetHoliday("Sexta-feira Santa", "portugal", -2),
        new EasterOffsetHoliday("Pascoa", "portugal", 0),
        new FixedDateHoliday("Dia da Liberdade", "portugal", 4, 25),
        new FixedDateHoliday("Dia do Trabalhador", "portugal", 5, 1),
        new EasterOffsetHoliday("Corpo de Deus", "portugal", 60),
        new FixedDateHoliday("Dia de Portugal", "portugal", 6, 10),
        new FixedDateHoliday("Assuncao", "portugal", 8, 15),
        new FixedDateHoliday("Implantacao da Republica", "portugal", 10, 5),
        new FixedDateHoliday("Dia de Todos os Santos", "portugal", 11, 1),
        new FixedDateHoliday("Restauracao da Independencia", "portugal", 12, 1),
        new FixedDateHoliday("Imaculada Conceicao", "portugal", 12, 8),
        new FixedDateHoliday("Natal", "portugal", 12, 25),
    };

    private static readonly Dictionary<string, IReadOnlyList<HolidayRule>> ByKey =
        new(StringComparer.OrdinalIgnoreCase) {
            ["portugal"] = Portugal,
        };

    /// <summary>Returns the rule list for a preset, or empty array if unknown.</summary>
    public static IReadOnlyList<HolidayRule> Get(string? key) =>
        string.IsNullOrWhiteSpace(key) ? Array.Empty<HolidayRule>()
            : ByKey.GetValueOrDefault(key, Array.Empty<HolidayRule>());
}
