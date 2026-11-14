package io.github.hongguo.personal;

/** SM3 (GB/T 32905) — pure Java, no BigInt dependency. */
final class Sm3 {
    private Sm3() {}

    static byte[] hash(byte[] source) {
        int n = source.length;
        int size = ((n + 9 + 63) / 64) * 64;
        byte[] data = new byte[size];
        System.arraycopy(source, 0, data, 0, n);
        data[n] = (byte) 0x80;
        long bitLen = (long) n * 8L;
        for (int i = 0; i < 8; i++) data[size - 1 - i] = (byte) (bitLen >>> (8 * i));

        int[] state = {
            0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
            0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e
        };
        int[] words = new int[68];
        for (int offset = 0; offset < size; offset += 64) {
            for (int i = 0; i < 16; i++) {
                int o = offset + i * 4;
                words[i] = ((data[o] & 0xff) << 24) | ((data[o + 1] & 0xff) << 16)
                    | ((data[o + 2] & 0xff) << 8) | (data[o + 3] & 0xff);
            }
            for (int i = 16; i < 68; i++) {
                int x = words[i - 16] ^ words[i - 9] ^ rot(words[i - 3], 15);
                words[i] = x ^ rot(x, 15) ^ rot(x, 23) ^ rot(words[i - 13], 7) ^ words[i - 6];
            }
            int a = state[0], b = state[1], c = state[2], d = state[3];
            int e = state[4], f = state[5], g = state[6], h = state[7];
            for (int i = 0; i < 64; i++) {
                int a12 = rot(a, 12);
                int tj = rot(i < 16 ? 0x79cc4519 : 0x7a879d8a, i);
                int s1 = rot(a12 + e + tj, 7);
                int s2 = s1 ^ a12;
                int ff = i < 16 ? (a ^ b ^ c) : ((a & b) | (a & c) | (b & c));
                int gg = i < 16 ? (e ^ f ^ g) : ((e & f) | ((~e) & g));
                int t1 = ff + d + s2 + (words[i] ^ words[i + 4]);
                int t2 = gg + h + s1 + words[i];
                d = c; c = rot(b, 9); b = a; a = t1;
                h = g; g = rot(f, 19); f = e;
                e = t2 ^ rot(t2, 9) ^ rot(t2, 17);
            }
            state[0] ^= a; state[1] ^= b; state[2] ^= c; state[3] ^= d;
            state[4] ^= e; state[5] ^= f; state[6] ^= g; state[7] ^= h;
        }
        byte[] out = new byte[32];
        for (int i = 0; i < 8; i++) {
            out[i * 4] = (byte) (state[i] >>> 24);
            out[i * 4 + 1] = (byte) (state[i] >>> 16);
            out[i * 4 + 2] = (byte) (state[i] >>> 8);
            out[i * 4 + 3] = (byte) state[i];
        }
        return out;
    }

    private static int rot(int x, int n) {
        n &= 31;
        return (x << n) | (x >>> (32 - n));
    }
}
