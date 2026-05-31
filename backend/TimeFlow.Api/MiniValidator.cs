using System.ComponentModel.DataAnnotations;

namespace TimeFlow.Api;

// Tiny ad-hoc DataAnnotations validator for minimal-API request records.
// ASP.NET's minimal APIs don't auto-validate parameter records (that's a
// MVC-only feature). This shim runs the same attributes inline so endpoint
// bodies keep their `[Required, MinLength(...)]` shape without dragging
// in FluentValidation.
//
// On failure, returns a dictionary in the shape `Results.ValidationProblem`
// expects: `{ "PropertyName": ["Error 1", "Error 2"] }`.
public static class MiniValidator {
    public static bool TryValidate<T>(T instance, out Dictionary<string, string[]> errors) where T : notnull {
        var ctx = new ValidationContext(instance);
        var results = new List<ValidationResult>();
        if (Validator.TryValidateObject(instance, ctx, results, validateAllProperties: true)) {
            errors = new();
            return true;
        }

        errors = results
            .SelectMany(r => (r.MemberNames.Any() ? r.MemberNames : new[] { "" })
                .Select(m => (Member: m, Message: r.ErrorMessage ?? "Invalid value.")))
            .GroupBy(t => t.Member)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Message).ToArray());
        return false;
    }
}
