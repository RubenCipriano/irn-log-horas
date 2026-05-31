namespace TimeFlow.Domain.Holidays;

// Easter (Western / Gregorian) for any modern year. Uses the Anonymous
// Gregorian Algorithm (Meeus / Jones / Butcher). Returns the Sunday;
// callers add an offset for Good Friday (-2), Corpus Christi (+60),
// etc.
//
// Valid for any year in the proleptic Gregorian calendar — we don't
// guard against AD 0 because nobody's logging hours then.
public static class EasterMath {
    public static DateOnly WesternEasterSunday(int year) {
        var a = year % 19;
        var b = year / 100;
        var c = year % 100;
        var d = b / 4;
        var e = b % 4;
        var f = (b + 8) / 25;
        var g = (b - f + 1) / 3;
        var h = (19 * a + b - d - g + 15) % 30;
        var i = c / 4;
        var k = c % 4;
        var l = (32 + 2 * e + 2 * i - h - k) % 7;
        var m = (a + 11 * h + 22 * l) / 451;
        var month = (h + l - 7 * m + 114) / 31;
        var day = ((h + l - 7 * m + 114) % 31) + 1;
        return new DateOnly(year, month, day);
    }
}
