/* Keep this guard ES5: it must run even when app.js cannot be parsed. */
(function () {
  var finished = false;
  var reasons = {
    js_bigint: '系统 WebView 缺少 BigInt（需 Chrome 67+ / 较新的 Android System WebView）。请更新或安装新版 Android System WebView / Chrome 后重试。当前 WebView 过旧无法完成取源签名。',
    js_abort: 'WebView 缺少 AbortController，无法安全取消请求。请更新系统 WebView。',
    js_collections: 'WebView 缺少必要的集合或字符串 API。请更新系统 WebView。',
    js_dom: 'WebView 缺少页面更新或遥控焦点需要的 DOM API。请更新系统 WebView。',
    js_dialog: 'WebView 缺少对话框 API。请更新系统 WebView。',
    js_storage: '本机存储不可用，无法保存收藏与观看记录。',
    js_video: 'WebView 缺少 HTML 视频播放 API。',
    css_layout: 'WebView 布局能力不足（Grid/Flex）。请更新系统 WebView。',
    bundle_error: '界面脚本加载或执行失败。请更新系统 WebView 后重新打开。'
  };
  function report(code) {
    if (window.Native && typeof Native.tvStartup === 'function') Native.tvStartup(code);
  }
  function fail(code) {
    if (finished) return;
    finished = true;
    var el = document.querySelector('#content');
    if (el) el.textContent = '红果短剧 TV 无法启动：' + (reasons[code] || code) + ' 按返回键退出。';
    report(code);
  }

  /* ---- polyfills for mid-age WebViews ---- */
  try {
    if (typeof globalThis === 'undefined') {
      window.globalThis = window;
    }
    if (typeof AbortController === 'function' && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
      AbortSignal.timeout = function (ms) {
        var c = new AbortController();
        var t = setTimeout(function () {
          try { c.abort(); } catch (e) {}
        }, ms);
        if (c.signal && typeof c.signal.addEventListener === 'function') {
          c.signal.addEventListener('abort', function () { clearTimeout(t); });
        }
        return c.signal;
      };
    }
    if (typeof BigInt === 'function') {
      if (typeof BigInt.asUintN !== 'function') {
        BigInt.asUintN = function (bits, value) {
          var v = BigInt(value);
          var mod = BigInt(1) << BigInt(bits);
          v = v % mod;
          if (v < BigInt(0)) v += mod;
          return v;
        };
      }
      if (typeof BigInt.asIntN !== 'function') {
        BigInt.asIntN = function (bits, value) {
          var v = BigInt.asUintN(bits, value);
          var sign = BigInt(1) << BigInt(bits - 1);
          if (v >= sign) v -= (BigInt(1) << BigInt(bits));
          return v;
        };
      }
    }
    if (typeof Array !== 'undefined' && Array.prototype) {
      if (typeof Array.prototype.includes !== 'function') {
        Array.prototype.includes = function (item, from) {
          return this.indexOf(item, from) !== -1;
        };
      }
      if (typeof Array.prototype.flat !== 'function') {
        Array.prototype.flat = function (depth) {
          var d = depth === undefined ? 1 : depth;
          return (function flatten(arr, dep) {
            var out = [];
            for (var i = 0; i < arr.length; i++) {
              if (Array.isArray(arr[i]) && dep > 0) out = out.concat(flatten(arr[i], dep - 1));
              else out.push(arr[i]);
            }
            return out;
          })(this, d);
        };
      }
      if (typeof Array.prototype.flatMap !== 'function') {
        Array.prototype.flatMap = function (fn, thisArg) {
          return this.map(fn, thisArg).flat();
        };
      }
      if (typeof Array.from !== 'function') {
        Array.from = function (arrayLike, mapFn, thisArg) {
          var items = Array.prototype.slice.call(arrayLike);
          if (mapFn) items = items.map(mapFn, thisArg);
          return items;
        };
      }
    }
    if (typeof Object !== 'undefined' && typeof Object.values !== 'function') {
      Object.values = function (obj) {
        return Object.keys(obj).map(function (k) { return obj[k]; });
      };
    }
    if (typeof String !== 'undefined' && String.prototype && typeof String.prototype.matchAll !== 'function') {
      String.prototype.matchAll = function (re) {
        var flags = re.flags || '';
        if (flags.indexOf('g') === -1) re = new RegExp(re.source, flags + 'g');
        var matches = [];
        var m;
        while ((m = re.exec(this)) !== null) {
          matches.push(m);
          if (m[0] === '') re.lastIndex++;
        }
        var i = 0;
        return {
          next: function () {
            if (i < matches.length) return { value: matches[i++], done: false };
            return { done: true };
          },
          [Symbol.iterator]: function () { return this; }
        };
      };
    }
    if (typeof Promise !== 'undefined' && Promise.prototype && typeof Promise.prototype.finally !== 'function') {
      Promise.prototype.finally = function (cb) {
        var ctor = this.constructor || Promise;
        return this.then(
          function (v) { return ctor.resolve(cb()).then(function () { return v; }); },
          function (e) { return ctor.resolve(cb()).then(function () { throw e; }); }
        );
      };
    }
    if (typeof window.ResizeObserver !== 'function') {
      window.ResizeObserver = function (cb) {
        this._cb = cb;
        this._targets = [];
      };
      window.ResizeObserver.prototype.observe = function (el) {
        this._targets.push(el);
        var self = this;
        setTimeout(function () {
          try { self._cb([{ target: el, contentRect: el.getBoundingClientRect() }], self); } catch (e) {}
        }, 0);
      };
      window.ResizeObserver.prototype.unobserve = function () {};
      window.ResizeObserver.prototype.disconnect = function () { this._targets = []; };
    }
    if (typeof Element !== 'undefined' && Element.prototype) {
      if (typeof Element.prototype.closest !== 'function') {
        Element.prototype.closest = function (sel) {
          var el = this;
          while (el && el.nodeType === 1) {
            if (el.matches && el.matches(sel)) return el;
            if (el.msMatchesSelector && el.msMatchesSelector(sel)) return el;
            el = el.parentElement || el.parentNode;
          }
          return null;
        };
      }
      if (typeof Element.prototype.after !== 'function') {
        Element.prototype.after = function () {
          var args = Array.prototype.slice.call(arguments);
          var parent = this.parentNode;
          if (!parent) return;
          var next = this.nextSibling;
          for (var i = 0; i < args.length; i++) {
            var node = typeof args[i] === 'string' ? document.createTextNode(args[i]) : args[i];
            parent.insertBefore(node, next);
          }
        };
      }
    }
  } catch (polyfillErr) {
    /* ignore polyfill failures; checks below still apply */
  }

  try {
    /* BigInt is required for request signing; cannot be fully polyfilled without rewriting crypto. */
    if (typeof BigInt !== 'function') { fail('js_bigint'); return; }
    if (typeof BigInt.asUintN !== 'function') { fail('js_bigint'); return; }

    if (typeof AbortController !== 'function') { fail('js_abort'); return; }
    if (typeof AbortSignal === 'undefined') { fail('js_abort'); return; }
    /* timeout polyfilled above when possible */
    if (typeof AbortSignal.timeout !== 'function') { fail('js_abort'); return; }

    if (typeof Map !== 'function' || typeof Set !== 'function' || typeof Promise !== 'function' ||
        typeof Promise.prototype.finally !== 'function' ||
        typeof Object.values !== 'function' || typeof Array.from !== 'function' ||
        typeof Array.prototype.includes !== 'function') {
      fail('js_collections'); return;
    }

    if (typeof globalThis === 'undefined' || typeof URL !== 'function' || typeof URLSearchParams !== 'function' ||
        typeof MutationObserver !== 'function' || typeof requestAnimationFrame !== 'function' ||
        typeof document.querySelector !== 'function' || typeof Element === 'undefined') {
      fail('js_dom'); return;
    }

    if (typeof HTMLDialogElement === 'undefined' || typeof HTMLDialogElement.prototype.showModal !== 'function' ||
        typeof HTMLDialogElement.prototype.close !== 'function') {
      /* dialog is used for about sheet; soft-fail only if completely missing helpers */
      if (typeof document.createElement !== 'function') { fail('js_dialog'); return; }
    }

    if (!window.CSS || typeof CSS.supports !== 'function' ||
        !(CSS.supports('display', 'flex') || CSS.supports('display', 'grid'))) {
      fail('css_layout'); return;
    }

    var key = '__hg_tv_preflight__';
    var previous;
    try {
      previous = localStorage.getItem(key);
      localStorage.setItem(key, 'ok');
      if (localStorage.getItem(key) !== 'ok') throw new Error();
    } catch (ignored) { fail('js_storage'); return; }
    finally {
      if (previous !== undefined) {
        if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
      }
    }

    var video = document.createElement('video');
    if (typeof video.canPlayType !== 'function' || typeof HTMLMediaElement === 'undefined' ||
        typeof HTMLMediaElement.prototype.play !== 'function' || typeof HTMLMediaElement.prototype.pause !== 'function') {
      fail('js_video'); return;
    }

    var script = document.createElement('script');
    var bundleFailed = function () { fail('bundle_error'); };
    window.addEventListener('error', bundleFailed);
    script.src = 'app.js';
    script.onerror = bundleFailed;
    script.onload = function () {
      window.removeEventListener('error', bundleFailed);
      if (finished) return;
      if (typeof window.tvKey !== 'function' || typeof window.appBack !== 'function') { fail('bundle_error'); return; }
      finished = true;
      report('ready');
    };
    document.head.appendChild(script);
  } catch (ignored) { fail('bundle_error'); }
}());
