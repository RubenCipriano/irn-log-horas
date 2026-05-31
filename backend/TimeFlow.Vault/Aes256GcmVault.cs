using System.Security.Cryptography;
using System.Text;

namespace TimeFlow.Vault;

// AES-256-GCM envelope encryption with HKDF-derived per-blob data keys
// bound to a caller-supplied context (typically an org id). The master
// key never touches user data directly — that's the "envelope" part: a
// 32-byte data key is derived from {master, salt, context} on every
// op, used once, then discarded. A leaked single ciphertext can't help
// an attacker decrypt a different one with a different (salt, context).
//
// Cross-tenant safety: passing the wrong context throws — the GCM auth
// tag fails because the data key is wrong. So storing an org's
// encrypted blob in another org's row makes it undecryptable; a hostile
// admin can't rebind blobs by editing the org_id column.
public interface IVaultService {
    /// <summary>Encrypt plaintext, bind to the given context. Returns the base64-encoded envelope.</summary>
    string Encrypt(string plaintext, string context);

    /// <summary>Decrypt a base64-encoded envelope under the same context. Throws on tamper / wrong context.</summary>
    string Decrypt(string envelopeB64, string context);
}

public sealed class Aes256GcmVault : IVaultService {
    private const string HkdfInfoPrefix = "tf-vault-v1:";
    private const int DataKeySize = 32;

    private readonly byte[] _masterKey;

    public Aes256GcmVault(string masterKey) {
        _masterKey = DecodeMasterKey(masterKey);
        if (_masterKey.Length < 32) {
            throw new InvalidOperationException("VAULT_KEY must be at least 32 bytes after base64-decode.");
        }
    }

    public string Encrypt(string plaintext, string context) {
        if (string.IsNullOrEmpty(plaintext)) throw new ArgumentException("Plaintext is empty.", nameof(plaintext));
        if (string.IsNullOrEmpty(context)) throw new ArgumentException("Context is empty.", nameof(context));

        var iv = RandomNumberGenerator.GetBytes(VaultEnvelope.IvSize);
        var salt = RandomNumberGenerator.GetBytes(VaultEnvelope.SaltSize);
        var dataKey = DeriveDataKey(salt, context);
        try {
            var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);
            var ciphertext = new byte[plaintextBytes.Length];
            var tag = new byte[VaultEnvelope.TagSize];

            using var aes = new AesGcm(dataKey, VaultEnvelope.TagSize);
            aes.Encrypt(iv, plaintextBytes, ciphertext, tag);

            var envelope = VaultEnvelope.Pack(VaultEnvelope.CurrentVersion, iv, salt, ciphertext, tag);
            return Convert.ToBase64String(envelope);
        } finally {
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }

    public string Decrypt(string envelopeB64, string context) {
        if (string.IsNullOrEmpty(envelopeB64)) throw new ArgumentException("Envelope is empty.", nameof(envelopeB64));
        if (string.IsNullOrEmpty(context)) throw new ArgumentException("Context is empty.", nameof(context));

        var envelope = Convert.FromBase64String(envelopeB64);
        var (version, iv, salt, ciphertext, tag) = VaultEnvelope.Unpack(envelope);
        if (version != VaultEnvelope.CurrentVersion) {
            throw new FormatException($"Unsupported vault envelope version: 0x{version:X2}.");
        }

        var dataKey = DeriveDataKey(salt, context);
        try {
            var plaintext = new byte[ciphertext.Length];
            using var aes = new AesGcm(dataKey, VaultEnvelope.TagSize);
            // Throws CryptographicException on tag mismatch — exactly what
            // happens if the context is wrong, the master key rotated
            // without re-encryption, or the ciphertext was tampered with.
            aes.Decrypt(iv, ciphertext, tag, plaintext);
            return Encoding.UTF8.GetString(plaintext);
        } finally {
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }

    private byte[] DeriveDataKey(byte[] salt, string context) {
        // HKDF-SHA256 with info = "tf-vault-v1:" || length-prefixed context.
        // Salt is per-blob (so re-encrypting the same plaintext yields a
        // different ciphertext) and lives in the envelope alongside the
        // ciphertext — public, not secret.
        var info = new byte[HkdfInfoPrefix.Length + 4 + Encoding.UTF8.GetByteCount(context)];
        Encoding.UTF8.GetBytes(HkdfInfoPrefix).CopyTo(info, 0);
        VaultEnvelope.EncodeContext(context).CopyTo(info, HkdfInfoPrefix.Length);
        return HKDF.DeriveKey(HashAlgorithmName.SHA256, _masterKey, DataKeySize, salt, info);
    }

    private static byte[] DecodeMasterKey(string raw) {
        if (string.IsNullOrWhiteSpace(raw)) {
            throw new InvalidOperationException("VAULT_KEY is empty.");
        }
        try { return Convert.FromBase64String(raw); }
        catch (FormatException) {
            // Allow raw UTF-8 secrets too — useful for dev where you just
            // dropped a string in .env. Production should use base64 of
            // 32 random bytes (`openssl rand -base64 32`).
            return Encoding.UTF8.GetBytes(raw);
        }
    }
}
