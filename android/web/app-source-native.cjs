/**
 * TV app-source without BigInt.
 * Playback uses Native.signPlayer; catalog/search fall back to limited paths.
 */
const { registerPlaybackDevice } = require('../../src/native/playback-device');
const { signPlayer } = require('./playback-signature-native.cjs');
const { abortError, throwIfAborted, boundedSignal, networkFailure } = require('../../src/native/request-signal');
const { gzipSync } = require('node:zlib'); // aliased in TV build

const VIDEO_API = 'https://api5-normal-sinfonlineb.fqnovel.com/novel/player/multi_video_model/v1/';
const VIDEO_TAB_API = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/video_tab/multi_video_model/v1/';
const SEARCH_API = 'https://api5-normal-sinfonlinea.fqnovel.com/reading/bookapi/search/tab/v';
const VIDEO_UA = 'com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)';
const DEVICE = {
  ac: 'wifi', channel: 'update_64', aid: '8662', app_name: 'novelread',
  version_code: '71332', version_name: '7.1.3.32', device_platform: 'android', os: 'android',
  ssmix: 'a', device_type: '25053RT47C', device_brand: 'Redmi', language: 'zh', os_api: '36',
  os_version: '16', manifest_version_code: '71332', resolution: '1280*2772', dpi: '520',
  update_version_code: '71332', host_abi: 'arm64-v8a', dragon_device_type: 'phone', pv_player: '71332',
  compliance_status: '0', need_personal_recommend: '1', player_so_load: '1', is_android_pad_screen: '0',
};
const PLAYBACK_DEVICE = { ...DEVICE, version_code: '74332', version_name: '7.4.3.32',
  manifest_version_code: '74332', update_version_code: '74332', pv_player: '74332' };
const VIDEO_TAB_DEVICE = { ...DEVICE, version_code: '73932', version_name: '7.3.9.32',
  manifest_version_code: '73932', update_version_code: '73932', pv_player: '73932' };

function pythonUrlEncode(values) {
  return Object.entries(values).map(([key, value]) => {
    const encode = (item) => encodeURIComponent(String(item == null ? '' : item))
      .replace(/[!'()']/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${encode(key)}=${encode(value)}`;
  }).join('&');
}

function playbackRequest(payload, identity, videoId = '') {
  const body = videoId ? null : gzipSync(Buffer.from(payload));
  const requestTicket = Date.now(), khronos = Math.floor(requestTicket / 1000);
  const device = { ...(videoId ? VIDEO_TAB_DEVICE : PLAYBACK_DEVICE), ...identity };
  const values = videoId ? { video_id: videoId, video_id_type: '0', device_level: '1',
    need_all_video_definition: '1', need_mp4_align: '0', use_os_player: '0',
    video_platform: '1024', source: '0', from_video_id: '' } : {};
  const query = pythonUrlEncode({ ...device, ...values, ts: String(khronos), _rticket: String(requestTicket) });
  const url = `${videoId ? VIDEO_TAB_API : VIDEO_API}?${query}`;
  const signature = signPlayer({ query, body, ts: khronos });
  const headers = {
    'User-Agent': VIDEO_UA.replace(DEVICE.version_code, device.version_code),
    Accept: 'application/json; charset=utf-8,application/x-protobuf',
    'x-ss-req-ticket': signature['x-ss-req-ticket'], 'sdk-version': '2', 'x-xs-from-web': '0',
    'passport-sdk-version': videoId ? '50561' : '5051452', 'x-ss-dp': String(device.aid),
    'x-khronos': signature['x-khronos'],
    'x-ladon': signature['x-ladon'], 'x-argus': signature['x-argus'], 'x-tt-dt': '',
    'x-tt-store-region': 'cn', 'x-tt-store-region-src': 'did',
  };
  if (body) Object.assign(headers, {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'gzip',
    'x-ss-stub': signature['x-ss-stub'],
  });
  return { url, method: videoId ? 'GET' : 'POST', headers, body };
}

// Re-use requestJson from original by minimal axios path via global fetch in browser —
// On TV, transport goes through Native.request. For bundled code, import axios alias.
async function requestJson(url, options, deadline, signal) {
  const axios = require('axios');
  const requestOptions = { ...options };
  const timeout = Math.max(1000, deadline - Date.now());
  const response = await axios({
    ...requestOptions, url, timeout, signal, maxRedirects: 0,
    responseType: 'text', transformResponse: [(data) => data],
    validateStatus: () => true,
  });
  if (response.status >= 400) {
    const err = new Error('HTTP ' + response.status);
    err.status = response.status;
    err.code = 'HTTP_' + response.status;
    throw err;
  }
  if (!response.data) {
    const err = new Error('empty');
    err.code = 'EMPTY_RESPONSE';
    throw err;
  }
  return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
}

let playbackQueue = Promise.resolve();
let playbackReadyAt = 0;
let playbackRejection = null;

async function fetchAppPlayUrl(vid, options = {}) {
  throwIfAborted(options.signal);
  vid = String(vid || '');
  if (!/^\d{1,30}$/.test(vid)) throw new Error('分集编号无效');
  const previousRejection = playbackRejection;
  const pending = playbackQueue.then(async () => {
    throwIfAborted(options.signal);
    if (playbackRejection !== previousRejection) throw playbackRejection;
    const wait = playbackReadyAt - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      return await fetchAppPlayUrlFresh(vid, options);
    } catch (error) {
      if ([403, 429].includes(error.status) || error.code === 'BUSINESS_REJECTED' || error.code === 'DEVICE_REGISTRATION_FAILED')
        playbackRejection = error;
      throw error;
    } finally {
      playbackReadyAt = Date.now() + 1000;
    }
  });
  playbackQueue = pending.catch(() => {});
  return pending;
}

async function fetchAppPlayUrlFresh(vid, options) {
  const payload = JSON.stringify({
    biz_param: { detail_page_version: 0, device_level: 3, disable_digg_stat: false, need_all_video_definition: true, need_mp4_align: false, use_os_player: false, use_server_dns: false, video_platform: 1024 },
    mixed_video_id_map: { '1004': [vid] },
  });
  let identity = await registerPlaybackDevice(requestJson, { signal: options.signal });
  throwIfAborted(options.signal);
  const deadline = Date.now() + 12000;
  const signed = playbackRequest(payload, identity, '');
  const response = await requestJson(signed.url, { method: signed.method, headers: signed.headers, data: signed.body }, deadline, options.signal);
  // Extract play URL from response — structure matches desktop
  const raw = typeof response === 'string' ? response : JSON.stringify(response);
  const data = typeof response === 'object' ? response : JSON.parse(raw);
  const video = data?.data?.video_model || data?.video_model || data?.data;
  // Try common paths
  let url = null, contentKey = null;
  const walk = (obj, depth) => {
    if (!obj || depth > 6 || url) return;
    if (typeof obj === 'string' && /^https:\/\//.test(obj) && /\.mp4|video|media/i.test(obj)) { url = obj; return; }
    if (typeof obj !== 'object') return;
    if (obj.main_url || obj.url || obj.play_url) url = obj.main_url || obj.url || obj.play_url;
    if (obj.key || obj.content_key) contentKey = obj.key || obj.content_key;
    for (const k of Object.keys(obj)) walk(obj[k], depth + 1);
  };
  walk(data, 0);
  if (!url) {
    const err = new Error('未解析到播放地址');
    err.code = 'INVALID_RESPONSE';
    throw err;
  }
  return { url, contentKey, source: 'app', userAgent: VIDEO_UA };
}

function signedSearchRequest() { throw Object.assign(new Error('TV native 暂用网页搜索'), { code: 'NOT_SUPPORTED' }); }
function signedMetadataRequest() { throw Object.assign(new Error('TV native 暂用网页目录'), { code: 'NOT_SUPPORTED' }); }
function signedAccountRequest() { throw Object.assign(new Error('TV native 不支持账号'), { code: 'NOT_SUPPORTED' }); }
function parseSearchInteger(v) { return parseInt(v, 10) || 0; }
function preserveLargeJsonIntegers(raw) { return raw; }

module.exports = {
  fetchAppPlayUrl, signedSearchRequest, signedMetadataRequest, signedAccountRequest,
  parseSearchInteger, preserveLargeJsonIntegers, requestJson, SEARCH_API, SEARCH_UA: VIDEO_UA,
};
