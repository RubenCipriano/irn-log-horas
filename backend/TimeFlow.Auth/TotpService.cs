using System.Security.Cryptography;
using OtpNet;

namespace TimeFlow.Auth;

// Thin RFC 6238 wrapper. Generates a base32-encoded secret on enrol,
// verifies 6-digit codes from any standard authenticator app.
//
// Window: ±1 step (30 s) to absorb clock skew between the user's device
// and the server. Wider windows trade security for tolerance.
public interface ITotpService
{
    /// <summary>Generate a fresh base32 secret (20 bytes / 160 bits). Returned to enrol UI for QR generation.</summary>
    string NewSecret();

    /// <summary>Format the `otpauth://` URI an authenticator app can scan.</summary>
    string FormatUri(string secret, string accountName, string issuer = "TimeFlow");

    /// <summary>Validate a 6-digit code. ±1 step window.</summary>
    bool Verify(string secret, string code);
}

public sealed class TotpService : ITotpService
{
    public string NewSecret()
    {
        var bytes = RandomNumberGenerator.GetBytes(20);
        return Base32Encoding.ToString(bytes);
    }

    public string FormatUri(string secret, string accountName, string issuer = "TimeFlow")
    {
        return new OtpUri(OtpType.Totp, secret, accountName, issuer).ToString();
    }

    public bool Verify(string secret, string code)
    {
        if (string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(code)) return false;
        try
        {
            var totp = new Totp(Base32Encoding.ToBytes(secret));
            return totp.VerifyTotp(code.Trim(), out _, new VerificationWindow(previous: 1, future: 1));
        }
        catch
        {
            return false;
        }
    }
}
