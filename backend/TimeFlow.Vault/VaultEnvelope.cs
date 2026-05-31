using System.Buffers.Binary;

namespace TimeFlow.Vault;

// On-the-wire format for an encrypted blob. Versioned so we can change
// the crypto without losing old data — `Decrypt` switches on the version
// byte and dispatches.
//
// Layout (binary, then base64-encoded for DB storage):
//   [0]         version byte (currently 0x01)
//   [1..13)     12-byte AES-GCM IV (96 bits — GCM's native nonce size)
//   [13..29)    16-byte HKDF salt (a per-blob random; mixed into the
//               data key derivation so re-encrypting the same plaintext
//               with the same context yields a different ciphertext)
//   [29..N)     ciphertext
//   [N..N+16)   16-byte GCM authentication tag
//
// The IV and salt are public values — only the master key + the binding
// context need to stay secret. We DON'T store the context inside the
// envelope: it's supplied at decrypt-time, so a row stolen from one
// org's column can't be decrypted against another org's id.
internal static class VaultEnvelope {
    public const byte CurrentVersion = 0x01;
    public const int IvSize = 12;
    public const int SaltSize = 16;
    public const int TagSize = 16;
    public const int HeaderSize = 1 + IvSize + SaltSize; // 29

    public static byte[] Pack(byte version, ReadOnlySpan<byte> iv, ReadOnlySpan<byte> salt, ReadOnlySpan<byte> ciphertext, ReadOnlySpan<byte> tag) {
        if (iv.Length != IvSize) throw new ArgumentException("IV must be 12 bytes.", nameof(iv));
        if (salt.Length != SaltSize) throw new ArgumentException("Salt must be 16 bytes.", nameof(salt));
        if (tag.Length != TagSize) throw new ArgumentException("Tag must be 16 bytes.", nameof(tag));

        var buf = new byte[HeaderSize + ciphertext.Length + TagSize];
        buf[0] = version;
        iv.CopyTo(buf.AsSpan(1, IvSize));
        salt.CopyTo(buf.AsSpan(1 + IvSize, SaltSize));
        ciphertext.CopyTo(buf.AsSpan(HeaderSize, ciphertext.Length));
        tag.CopyTo(buf.AsSpan(HeaderSize + ciphertext.Length, TagSize));
        return buf;
    }

    public static (byte Version, byte[] Iv, byte[] Salt, byte[] Ciphertext, byte[] Tag) Unpack(byte[] envelope) {
        if (envelope is null || envelope.Length < HeaderSize + TagSize) {
            throw new FormatException("Envelope too small.");
        }
        var version = envelope[0];
        var iv = envelope.AsSpan(1, IvSize).ToArray();
        var salt = envelope.AsSpan(1 + IvSize, SaltSize).ToArray();
        var ctLen = envelope.Length - HeaderSize - TagSize;
        var ciphertext = envelope.AsSpan(HeaderSize, ctLen).ToArray();
        var tag = envelope.AsSpan(HeaderSize + ctLen, TagSize).ToArray();
        return (version, iv, salt, ciphertext, tag);
    }

    // Length-prefix-encodes the context so that "abc"+"def" can't collide
    // with "ab"+"cdef" when concatenated for HKDF info. Defensive even
    // though we only feed one string in today.
    public static byte[] EncodeContext(string context) {
        var bytes = System.Text.Encoding.UTF8.GetBytes(context);
        var out_ = new byte[4 + bytes.Length];
        BinaryPrimitives.WriteInt32BigEndian(out_.AsSpan(0, 4), bytes.Length);
        bytes.CopyTo(out_.AsSpan(4));
        return out_;
    }
}
