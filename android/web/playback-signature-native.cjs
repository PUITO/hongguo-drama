/** TV-only: signing via Java AppSigner. No BigInt in this module. */
function signPlayer(args) {
  if (typeof Native === 'undefined' || typeof Native.signPlayer !== 'function') {
    throw new Error('Native.signPlayer unavailable');
  }
  const body = args && args.body;
  let bodyB64 = '';
  if (body && body.length) {
    if (typeof Buffer !== 'undefined') bodyB64 = Buffer.from(body).toString('base64');
    else {
      let s = '';
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      bodyB64 = btoa(s);
    }
  }
  const raw = Native.signPlayer(String((args && args.query) || ''), bodyB64, String(args && args.ts));
  if (!raw) throw new Error('native signPlayer failed');
  return JSON.parse(raw);
}
module.exports = { signPlayer, Argus: {}, Ladon: {}, ProtoBuf: null, Simon: null };
