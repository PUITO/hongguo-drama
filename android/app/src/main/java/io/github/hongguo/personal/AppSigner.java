package io.github.hongguo.personal;

import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Native port of src/native/playback-signature.js (signPlayer / Argus / Ladon / Simon).
 * Uses Java long for unsigned 64-bit ops so WebView BigInt is not required.
 */
final class AppSigner {
    private static final long LICENSE_ID = 1611921764L;
    private static final byte[] SIGN_KEY = hex("fc78e0a9657a0c748ce51559903ccf03510e51d3cff232d71343e88a321c5304");
    private static final byte[] AES_KEY = hex("d31e3718288a1027baab59f146a09a9c");
    private static final byte[] AES_IV = hex("ea180a0336ed352fcd24e4d50018ae54");
    private static final byte[] MAGIC8 = hex("f2f7fcfff2f7fcff");
    private static final byte[] TAIL9 = hex("eafb2cfe8568519154");
    private static final long SIMON_CONST = 0x3dc94c3a046d678bL;
    private static final SecureRandom RNG = new SecureRandom();

    private AppSigner() {}

    /** Returns JSON object with x-ss-req-ticket, x-khronos, x-ladon, x-argus, optional x-ss-stub. */
    static String signPlayer(String query, byte[] body, long ts) throws Exception {
        if (query == null) throw new IllegalArgumentException("query required");
        String aidValue = queryParam(query, "aid");
        long aid = 1967L;
        if (aidValue != null && aidValue.matches("^[+-]?\\d+$")) {
            try { aid = Long.parseLong(aidValue); } catch (NumberFormatException ignored) {}
        }
        String stub = "";
        if (body != null && body.length > 0) {
            MessageDigest md = MessageDigest.getInstance("MD5");
            stub = toHex(md.digest(body));
        }
        int randField = RNG.nextInt();
        byte[] ladonRandom = new byte[4];
        RNG.nextBytes(ladonRandom);
        String deviceId = queryParam(query, "device_id");
        if (deviceId == null) deviceId = "";
        String installId = "";

        JSONObject headers = new JSONObject();
        headers.put("x-ss-req-ticket", String.valueOf(ts * 1000L));
        headers.put("x-khronos", String.valueOf(ts));
        headers.put("x-ladon", ladonEncrypt(ts, LICENSE_ID, aid, ladonRandom));
        headers.put("x-argus", argusSign(query, stub, ts, aid, LICENSE_ID, deviceId, installId, randField));
        if (!stub.isEmpty()) headers.put("x-ss-stub", stub);
        return headers.toString();
    }

    static boolean available() { return true; }

    // ---- Ladon ----
    private static String ladonEncrypt(long ts, long licenseId, long aid, byte[] randomBytes) throws Exception {
        String aidText = Long.toString(aid);
        MessageDigest md = MessageDigest.getInstance("MD5");
        md.update(randomBytes);
        md.update(aidText.getBytes(StandardCharsets.US_ASCII));
        String digest = toHex(md.digest());
        byte[] ascii = digest.getBytes(StandardCharsets.US_ASCII);
        long[] words = new long[4];
        for (int i = 0; i < 4; i++) words[i] = readU64LE(ascii, i * 8);
        List<Long> table = new ArrayList<>();
        table.add(words[0]);
        List<Long> queue = new ArrayList<>();
        queue.add(words[2]);
        queue.add(words[3]);
        long b0 = words[0], b8 = words[1];
        for (int i = 0; i < 34; i++) {
            long x8 = u64(ror64(b8, 8) + b0) ^ (long) i;
            queue.add(x8);
            x8 ^= rol64(b0, 3);
            x8 = u64(x8);
            table.add(x8);
            b0 = x8;
            b8 = queue.remove(0);
        }
        String text = ts + "-" + licenseId + "-" + aidText;
        byte[] input = pad16(text.getBytes(StandardCharsets.US_ASCII));
        byte[] out = new byte[input.length];
        for (int at = 0; at < input.length; at += 16) {
            long a = readU64LE(input, at), b = readU64LE(input, at + 8);
            for (int i = 0; i < 34; i++) {
                b = table.get(i) ^ u64(a + ror64(b, 8));
                a = b ^ rol64(a, 3);
            }
            writeU64LE(out, at, u64(a));
            writeU64LE(out, at + 8, u64(b));
        }
        byte[] result = new byte[randomBytes.length + out.length];
        System.arraycopy(randomBytes, 0, result, 0, randomBytes.length);
        System.arraycopy(out, 0, result, randomBytes.length, out.length);
        return Base64.encodeToString(result, Base64.NO_WRAP);
    }

    // ---- Argus ----
    private static String argusSign(String query, String stubHex, long ts, long aid, long licenseId,
                                    String deviceId, String installId, int randField) throws Exception {
        if (aid == 0) aid = 1967L;
        if (licenseId == 0) licenseId = LICENSE_ID;
        String versionName = queryParam(query, "version_name");
        if (versionName == null) versionName = "";
        Proto bean = new Proto();
        bean.putVarint(1, 1077940818L);
        bean.putVarint(2, 2L);
        bean.putVarint(3, randField & 0xffffffffL);
        bean.putUtf8(4, String.valueOf(aid));
        bean.putUtf8(5, deviceId == null ? "" : deviceId);
        bean.putUtf8(6, String.valueOf(licenseId));
        bean.putUtf8(7, versionName);
        bean.putUtf8(8, "v04.04.05-ov-android");
        bean.putVarint(9, 134744640L);
        bean.putBytes(10, new byte[8]);
        bean.putVarint(11, 0L);
        bean.putVarint(12, ts << 1); // integer(ts) << 1
        bean.putBytes(13, bodyHash(stubHex));
        bean.putBytes(14, queryHash(query));
        Proto nested15 = new Proto();
        nested15.putVarint(1, 1L); nested15.putVarint(2, 1L); nested15.putVarint(3, 1L); nested15.putVarint(7, 0xc792ecccL);
        bean.putBytes(15, nested15.toBytes()); // putProtobuf
        bean.putUtf8(16, installId == null ? "" : installId);
        bean.putUtf8(20, "none");
        bean.putVarint(21, 738L);
        Proto nested23 = new Proto();
        nested23.putUtf8(1, "NX551J"); nested23.putVarint(2, 8196L); nested23.putVarint(4, 0x80e0d800L);
        bean.putBytes(23, nested23.toBytes());
        bean.putVarint(25, 2L);

        byte[] protobuf = pad16(bean.toBytes());
        // Simon encrypt blocks
        long[] keyWords = new long[4];
        for (int i = 0; i < 4; i++) keyWords[i] = readU64LE(SIGN_KEY, i * 8);
        List<byte[]> blocks = new ArrayList<>();
        byte[] paddedPb = pad16(protobuf);
        for (int at = 0; at < paddedPb.length; at += 16) {
            long[] enc = simonEncrypt(readU64LE(paddedPb, at), readU64LE(paddedPb, at + 8), keyWords);
            blocks.add(le64(enc[0]));
            blocks.add(le64(enc[1]));
        }
        int framedLen = MAGIC8.length + blocks.size() * 8 + TAIL9.length;
        byte[] framed = new byte[framedLen];
        System.arraycopy(MAGIC8, 0, framed, 0, 8);
        int off = 8;
        for (byte[] b : blocks) { System.arraycopy(b, 0, framed, off, 8); off += 8; }
        System.arraycopy(TAIL9, 0, framed, off, TAIL9.length);
        for (int i = 8; i < framed.length; i++) framed[i] ^= MAGIC8[i % 8];
        // reverse + "ao"
        byte[] reversed = new byte[framed.length];
        for (int i = 0; i < framed.length; i++) reversed[i] = framed[framed.length - 1 - i];
        byte[] withAo = new byte[reversed.length + 2];
        System.arraycopy(reversed, 0, withAo, 0, reversed.length);
        withAo[reversed.length] = 'a';
        withAo[reversed.length + 1] = 'o';
        byte[] aesIn = pad16(withAo);
        javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/CBC/NoPadding");
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE,
            new javax.crypto.spec.SecretKeySpec(AES_KEY, "AES"),
            new javax.crypto.spec.IvParameterSpec(AES_IV));
        byte[] encrypted = cipher.doFinal(aesIn);
        byte[] out = new byte[2 + encrypted.length];
        out[0] = (byte) 0xf2; out[1] = (byte) 0x81;
        System.arraycopy(encrypted, 0, out, 2, encrypted.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }

    private static byte[] bodyHash(String stubHex) {
        if (stubHex == null || stubHex.isEmpty()) return slice(Sm3.hash(new byte[16]), 0, 6);
        if (!stubHex.matches("(?i)^(?:[a-f\\d]{2})+$")) return slice(Sm3.hash(new byte[16]), 0, 6);
        return slice(Sm3.hash(hex(stubHex)), 0, 6);
    }

    private static byte[] queryHash(String query) {
        if (query == null || query.isEmpty()) return slice(Sm3.hash(new byte[16]), 0, 6);
        return slice(Sm3.hash(query.getBytes(StandardCharsets.UTF_8)), 0, 6);
    }

    // ---- Simon ----
    private static long[] simonKeyExpansion(long[] key) {
        long[] expanded = new long[72];
        for (int i = 0; i < 4; i++) expanded[i] = u64(key[i]);
        for (int i = 4; i < 72; i++) {
            long tmp = ror64(expanded[i - 1], 3) ^ expanded[i - 3];
            tmp ^= ror64(tmp, 1);
            long bit = (SIMON_CONST >>> ((i - 4) % 62)) & 1L;
            expanded[i] = u64(~expanded[i - 4] ^ tmp ^ bit ^ 3L);
        }
        return expanded;
    }

    private static long[] simonEncrypt(long left, long right, long[] key) {
        long[] rk = simonKeyExpansion(key);
        long x = u64(left), y = u64(right);
        for (long roundKey : rk) {
            long previous = y;
            y = u64(x ^ (rol64(y, 1) & rol64(y, 8)) ^ rol64(y, 2) ^ roundKey);
            x = previous;
        }
        return new long[]{x, y};
    }

    // ---- Proto ----
    private static final class Proto {
        private final List<byte[]> parts = new ArrayList<>();
        void putVarint(int tag, long value) {
            parts.add(varint((tag << 3)));
            parts.add(varint(value));
        }
        void putBytes(int tag, byte[] value) {
            parts.add(varint((tag << 3) | 2));
            parts.add(varint(value.length));
            parts.add(value);
        }
        void putUtf8(int tag, String value) {
            putBytes(tag, value.getBytes(StandardCharsets.UTF_8));
        }
        byte[] toBytes() {
            int n = 0; for (byte[] p : parts) n += p.length;
            byte[] out = new byte[n]; int o = 0;
            for (byte[] p : parts) { System.arraycopy(p, 0, out, o, p.length); o += p.length; }
            return out;
        }
    }

    private static byte[] varint(long value) {
        long n = value & 0xffffffffL;
        List<Integer> out = new ArrayList<>();
        while (n >= 128) {
            out.add((int) ((n & 127) | 128));
            n >>= 7;
        }
        out.add((int) n);
        byte[] b = new byte[out.size()];
        for (int i = 0; i < out.size(); i++) b[i] = (byte) (int) out.get(i);
        return b;
    }

    // ---- helpers ----
    private static long u64(long v) { return v; } // Java long is already 64-bit two's complement; bitwise ops as unsigned via >>>
    private static long rol64(long v, int bits) {
        bits &= 63;
        return (v << bits) | (v >>> (64 - bits));
    }
    private static long ror64(long v, int bits) { return rol64(v, 64 - (bits & 63)); }
    private static byte[] pad16(byte[] data) {
        int pad = 16 - (data.length % 16);
        if (pad == 0) pad = 16;
        byte[] out = new byte[data.length + pad];
        System.arraycopy(data, 0, out, 0, data.length);
        for (int i = data.length; i < out.length; i++) out[i] = (byte) pad;
        return out;
    }
    private static long readU64LE(byte[] b, int off) {
        long v = 0;
        for (int i = 0; i < 8; i++) v |= ((long) (b[off + i] & 0xff)) << (8 * i);
        return v;
    }
    private static void writeU64LE(byte[] b, int off, long v) {
        for (int i = 0; i < 8; i++) b[off + i] = (byte) (v >>> (8 * i));
    }
    private static byte[] le64(long v) {
        byte[] b = new byte[8];
        writeU64LE(b, 0, v);
        return b;
    }
    private static byte[] slice(byte[] b, int from, int len) {
        byte[] o = new byte[len];
        System.arraycopy(b, from, o, 0, len);
        return o;
    }
    private static String queryParam(String query, String name) {
        for (String part : query.split("&")) {
            int at = part.indexOf('=');
            String key = at < 0 ? part : part.substring(0, at);
            try { key = java.net.URLDecoder.decode(key.replace("+", " "), "UTF-8"); } catch (Exception ignored) {}
            if (name.equals(key)) {
                String val = at < 0 ? "" : part.substring(at + 1);
                try { return java.net.URLDecoder.decode(val.replace("+", " "), "UTF-8"); } catch (Exception e) { return val; }
            }
        }
        return null;
    }
    private static byte[] hex(String s) {
        int n = s.length() / 2;
        byte[] out = new byte[n];
        for (int i = 0; i < n; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return out;
    }
    private static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte v : b) sb.append(String.format("%02x", v & 0xff));
        return sb.toString();
    }
}
