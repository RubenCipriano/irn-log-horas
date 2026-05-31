using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;

namespace TimeFlow.Auth;

// Argon2id PHC-string password hashing. Output format is the canonical
// `$argon2id$v=19$m=...,t=...,p=...$<salt-b64>$<hash-b64>` so the hash
// row carries its own parameters — future tuning doesn't break old
// hashes, and verification can detect them and reject anything that
// isn't argon2id.
//
// OWASP 2024 default params: m=64 MiB, t=3, p=4. Tweak via the static
// fields if a load test shows the default isn't right for your hardware.
public interface IPasswordHasher
{
    /// <summary>Hash a plaintext password to a self-describing PHC string.</summary>
    string Hash(string password);

    /// <summary>Verify a plaintext against a stored hash. Constant-time; false on any decode error.</summary>
    bool Verify(string password, string hash);
}

public sealed class Argon2PasswordHasher : IPasswordHasher
{
    private const int MemoryKib = 64 * 1024; // 64 MiB
    private const int Iterations = 3;
    private const int Parallelism = 4;
    private const int HashBytes = 32;
    private const int SaltBytes = 16;

    public string Hash(string password)
    {
        if (string.IsNullOrEmpty(password)) throw new ArgumentException("Password is empty.", nameof(password));

        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = ComputeHash(Encoding.UTF8.GetBytes(password), salt, MemoryKib, Iterations, Parallelism);
        return $"$argon2id$v=19$m={MemoryKib},t={Iterations},p={Parallelism}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public bool Verify(string password, string hash)
    {
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(hash)) return false;

        // Format: $argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>
        var parts = hash.Split('$', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 5 || parts[0] != "argon2id") return false;

        try
        {
            // parts[1] = "v=19"  (unused — we don't currently support v<19)
            // parts[2] = "m=...,t=...,p=..."
            var paramMap = parts[2].Split(',')
                .Select(p => p.Split('=', 2))
                .ToDictionary(kv => kv[0], kv => int.Parse(kv[1]));
            if (!paramMap.TryGetValue("m", out var m) || !paramMap.TryGetValue("t", out var t) || !paramMap.TryGetValue("p", out var p))
                return false;

            var salt = Convert.FromBase64String(parts[3]);
            var expected = Convert.FromBase64String(parts[4]);
            var actual = ComputeHash(Encoding.UTF8.GetBytes(password), salt, m, t, p);

            // Length mismatch can only happen if someone stored a wrong-size
            // hash; rejecting upfront avoids the FixedTimeEquals contract
            // violation (which throws on length mismatch).
            if (actual.Length != expected.Length) return false;
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch
        {
            return false;
        }
    }

    private static byte[] ComputeHash(byte[] password, byte[] salt, int memoryKib, int iterations, int parallelism)
    {
        using var argon2 = new Argon2id(password)
        {
            Salt = salt,
            DegreeOfParallelism = parallelism,
            MemorySize = memoryKib,
            Iterations = iterations,
        };
        return argon2.GetBytes(HashBytes);
    }
}
