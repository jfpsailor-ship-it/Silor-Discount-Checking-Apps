/* Discount Scanner — Sailor outlet tool. Plain JS, no build step. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var norm = SailorParse.norm;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  var fmt = function (n) {
    n = Math.round(n * 100) / 100;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };
  var pctTxt = function (p) { return (Math.round(p * 100) / 100).toString(); };
  var cls = function (p) { return p >= 50 ? 'd50' : p > 0 ? 'd30' : 'd0'; };
  var cleanSize = function (s) { return (!s || /^(0|NA|N\/A|-)$/i.test(s)) ? '—' : s; };
  var toastT;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ---------------- IndexedDB (phone-only overrides) ---------------- */
  function idb() {
    return new Promise(function (res, rej) {
      var q = indexedDB.open('discount-scan', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('kv'); };
      q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
    });
  }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (res) { var r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(undefined); }; }); }).catch(function () { return undefined; }); }
  function idbSet(k, v) { return idb().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = function () { rej(t.error); }; }); }); }
  function idbDel(k) { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); }).catch(function () { }); }

  /* ---------------- Data / rules ---------------- */
  var S = { stock: null, disc: null, rows: [], byBarcode: new Map(), byKey: new Map(), src: { stock: 'github', disc: 'github' }, groups: null };

  function fetchJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }

  function seasonYear(s) { var m = String(s || '').match(/(?:19|20)\d{2}/g); return m ? +m[m.length - 1] : null; }

  function build() {
    var st = S.stock, d = S.disc, rule = d.yearRule || {}, vat = d.vat || {};
    var acc = new Set((vat.accessoryLabels || []).map(norm));
    var lists = (d.lists || []).map(function (l) { return { pct: l.pct, name: l.name, keys: new Set(l.keys || []), bcs: new Set(l.barcodes || []) }; });
    S.byBarcode = new Map(); S.byKey = new Map(); S.groups = null;
    S.rows = st.rows.map(function (a) {
      var r = { barcode: a[0], style: a[1], colour: a[2], size: a[3], mc: a[4], label: a[5], gender: a[6], cat: a[7], season: a[8], a01: a[9], qty: a[10], mrp: a[11] };
      r.key = norm(r.style + ' ' + (r.colour || 'N/A'));
      var pct = 0, src = '', y = seasonYear(r.season);
      if (rule.pct && y && y <= rule.maxYear) { pct = rule.pct; src = 'সিজন (A02) ' + rule.maxYear + ' বা আগের'; }
      for (var i = 0; i < lists.length; i++) {
        var l = lists[i];
        if ((l.keys.has(r.key) || l.bcs.has(r.barcode)) && l.pct > pct) { pct = l.pct; src = l.name; }
      }
      r.pct = pct; r.src = src;
      r.acc = acc.has(norm(r.label));
      r.vatPct = r.acc ? (vat.accessories != null ? vat.accessories : 7.5) : (vat.garments != null ? vat.garments : 10);
      var disc = r.mrp * pct / 100; r.after = r.mrp - disc; r.discAmt = disc;
      r.vatAmt = r.after * r.vatPct / 100; r.final = r.after + r.vatAmt;
      S.byBarcode.set(r.barcode, r);
      var arr = S.byKey.get(r.key); if (arr) arr.push(r); else S.byKey.set(r.key, [r]);
      return r;
    });
  }

  function loadData() {
    return Promise.all([idbGet('stock'), idbGet('discounts')]).then(function (loc) {
      var pS = loc[0] ? Promise.resolve(loc[0]) : fetchJSON('data/stock.json');
      var pD = loc[1] ? Promise.resolve(loc[1]) : fetchJSON('data/discounts.json');
      S.src.stock = loc[0] ? 'phone' : 'github'; S.src.disc = loc[1] ? 'phone' : 'github';
      return Promise.all([pS, pD]);
    }).then(function (x) {
      S.stock = x[0]; S.disc = x[1]; build(); afterLoad();
    }).catch(function (e) {
      var b = $('#dataBadge'); b.textContent = 'ডেটা লোড হয়নি'; b.classList.add('warn');
      toast('ডেটা লোড করা যায়নি — ইন্টারনেট চেক করুন');
      console.error(e);
    });
  }

  function afterLoad() {
    var b = $('#dataBadge');
    var local = S.src.stock === 'phone' || S.src.disc === 'phone';
    b.textContent = 'স্টক: ' + S.stock.updated + (local ? ' · ফোন' : '');
    b.classList.toggle('warn', local);
    renderStatus(); renderList(true); resetDraft(); renderHistory();
  }

  /* ---------------- Result rendering ---------------- */
  function sizeOrder(s) {
    var order = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
    var i = order.indexOf(String(s).toUpperCase()); if (i >= 0) return [0, i, ''];
    var n = parseFloat(s); if (!isNaN(n)) return [1, n, '']; return [2, 0, String(s)];
  }
  function cmpSize(a, b) {
    var x = sizeOrder(a.size), y = sizeOrder(b.size);
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], undefined, { numeric: true });
  }
  function dd(k, v) { return v ? '<dt>' + k + '</dt><dd>' + esc(v) + '</dd>' : ''; }

  function itemHTML(r) {
    var sib = (S.byKey.get(r.key) || []).slice().sort(cmpSize);
    var tot = sib.reduce(function (a, x) { return a + x.qty; }, 0);
    var c = cls(r.pct);
    var h = '<div class="res">';
    h += '<div class="band ' + c + '"><div class="pct">' + pctTxt(r.pct) + '%</div><div class="lbl">' +
      (r.pct > 0 ? 'ডিসকাউন্ট পণ্য' : 'ডিসকাউন্ট নেই') + '<small>' + (r.pct > 0 ? esc(r.src) : 'রেগুলার প্রাইস') + '</small></div></div>';
    h += '<div class="pricebox"><div class="pr"><span>MRP</span><b>৳ ' + fmt(r.mrp) + '</b></div>';
    if (r.pct > 0) {
      h += '<div class="pr minus"><span>ডিসকাউন্ট (' + pctTxt(r.pct) + '%)</span><b>− ৳ ' + fmt(r.discAmt) + '</b></div>';
      h += '<div class="pr"><span>ডিসকাউন্টের পর</span><b>৳ ' + fmt(r.after) + '</b></div>';
    }
    h += '<div class="pr"><span>ভ্যাট ' + pctTxt(r.vatPct) + '% (' + (r.acc ? 'একসেসোরিজ' : 'গার্মেন্টস/অন্যান্য') + ')</span><b>+ ৳ ' + fmt(r.vatAmt) + '</b></div>';
    var rounded = Math.round(r.final);
    h += '<div class="pr total"><span>কাস্টমারের দাম<br><small class="muted">ভ্যাটসহ</small></span><b>৳ ' + fmt(rounded) + '</b></div>';
    if (Math.abs(rounded - r.final) > 0.004) h += '<div class="muted small" style="text-align:right">সঠিক হিসাব: ৳ ' + fmt(r.final) + '</div>';
    h += '</div>';
    h += '<div class="stockrow"><div class="stat' + (r.qty <= 0 ? ' low' : '') + '"><b>' + fmt(r.qty) + '</b><span>স্টক (এই সাইজ)</span></div>' +
      '<div class="stat"><b>' + fmt(tot) + '</b><span>এই স্টাইল-কালারে মোট</span></div></div>';
    h += '<dl class="det">' + dd('বারকোড', r.barcode) + dd('স্টাইল কোড', r.style) + dd('কালার', r.colour) + dd('সাইজ', cleanSize(r.size) === '—' ? '' : r.size) +
      dd('মাস্টার ক্যাটাগরি', r.mc) + dd('ক্যাটাগরি', r.cat) + dd('লেবেল', r.label) + dd('জেন্ডার', r.gender) + dd('সিজন (A02)', r.season) + dd('A01', r.a01) + '</dl>';
    if (sib.length > 1) {
      h += '<div class="sizes"><h4>এই স্টাইল-কালারের সাইজ ও স্টক</h4><div class="chips">' + sib.map(function (x) {
        return '<span class="chip' + (x === r ? ' me' : '') + (x.qty <= 0 ? ' zero' : '') + '">' + esc(cleanSize(x.size)) + ': ' + fmt(x.qty) + '</span>';
      }).join('') + '</div></div>';
    }
    return h + '</div>';
  }

  function showItem(r, opts) {
    $('#result').innerHTML = itemHTML(r);
    feedback(r.pct);
    pushHistory({ code: r.barcode, pct: r.pct, title: r.style + (r.colour ? ' · ' + r.colour : '') + (cleanSize(r.size) !== '—' ? ' · ' + r.size : '') });
    if (!opts || !opts.noScroll) { var el = $('#result'); var top = el.getBoundingClientRect().top; if (top > window.innerHeight * 0.6) window.scrollBy({ top: top - window.innerHeight * 0.45, behavior: 'smooth' }); }
  }
  function showMissing(code) {
    $('#result').innerHTML = '<div class="res"><div class="band miss"><div class="pct">?</div><div class="lbl">স্টকে পাওয়া যায়নি<small>' + esc(code) + '</small></div></div>' +
      '<div class="pad muted">এই বারকোড বর্তমান স্টক ফাইলে নেই। স্টক ফাইল পুরোনো হতে পারে অথবা পণ্যটি অন্য আউটলেটের। ডেটা ট্যাব থেকে সর্বশেষ স্টক ফাইল দিন।</div></div>';
    feedback(-1);
    pushHistory({ code: code, pct: -1, title: 'পাওয়া যায়নি' });
  }
  function lookup(code, opts) {
    code = String(code || '').trim().toUpperCase(); if (!code) return;
    if (!S.byBarcode.size) { toast('ডেটা এখনো লোড হয়নি'); return; }
    var r = S.byBarcode.get(code);
    if (!r && /^\d+$/.test(code)) { // tolerate leading-zero differences
      r = S.byBarcode.get(code.replace(/^0+/, '')) || null;
    }
    if (r) showItem(r, opts); else showMissing(code);
  }

  /* ---------------- Feedback: vibration + beep ---------------- */
  var actx;
  function beepOn() { return store.get('beep', true); }
  function beep(freq, ms) {
    if (!beepOn()) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = freq; g.gain.value = 0.12;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000);
    } catch (e) { }
  }
  function iosHaptic() {
    try {
      var l = document.createElement('label'); l.style.cssText = 'position:fixed;left:-99px;top:-99px;opacity:0;pointer-events:none';
      var i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i);
      document.body.appendChild(l); l.click(); setTimeout(function () { l.remove(); }, 50);
    } catch (e) { }
  }
  function feedback(pct) {
    var pat = pct >= 50 ? [90, 60, 90] : pct > 0 ? [180] : [50];
    if (navigator.vibrate) { try { navigator.vibrate(pat); } catch (e) { } } else { iosHaptic(); }
    beep(pct >= 50 ? 1200 : pct > 0 ? 900 : pct < 0 ? 300 : 650, pct >= 50 ? 160 : 110);
  }

  /* ---------------- History ---------------- */
  var hist = store.get('hist', []);
  function pushHistory(h) {
    hist = hist.filter(function (x) { return x.code !== h.code; }); hist.unshift(h); hist = hist.slice(0, 15);
    store.set('hist', hist); renderHistory();
  }
  function renderHistory() {
    var el = $('#history');
    if (!hist.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h4>সাম্প্রতিক স্ক্যান</h4>' + hist.map(function (h, i) {
      return '<button class="hrow" data-h="' + i + '"><i class="dot ' + (h.pct < 0 ? 'miss' : cls(h.pct)) + '"></i><span>' + esc(h.title) + '</span><b>' + (h.pct < 0 ? '' : pctTxt(h.pct) + '%') + '</b></button>';
    }).join('');
  }
  $('#history').addEventListener('click', function (e) {
    var b = e.target.closest('[data-h]'); if (!b) return;
    var h = hist[+b.dataset.h]; var r = S.byBarcode.get(h.code);
    if (r) { $('#result').innerHTML = itemHTML(r); window.scrollTo({ top: 0, behavior: 'smooth' }); } else showMissing(h.code);
  });

  /* ---------------- Manual search ---------------- */
  $('#manual').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = norm($('#manualInput').value); if (!q) return;
    if (S.byBarcode.has(q)) { lookup(q); document.activeElement.blur(); return; }
    var out = [];
    for (var i = 0; i < S.rows.length && out.length < 25; i++) {
      var r = S.rows[i];
      if (r.barcode.indexOf(q) >= 0 || r.key.indexOf(q) >= 0) out.push(r);
    }
    if (!out.length) { showMissing(q); return; }
    if (out.length === 1) { showItem(out[0]); return; }
    $('#result').innerHTML = '<div class="res pad"><b>' + out.length + (out.length === 25 ? '+' : '') + ' টি মিল পাওয়া গেছে</b><div class="matches">' + out.map(function (r) {
      return '<button type="button" class="match" data-bc="' + esc(r.barcode) + '"><span>' + esc(r.style + ' ' + r.colour) + ' · ' + esc(cleanSize(r.size)) + '</span><b>' + pctTxt(r.pct) + '%</b></button>';
    }).join('') + '</div></div>';
  });
  $('#result').addEventListener('click', function (e) {
    var b = e.target.closest('[data-bc]'); if (b) { var r = S.byBarcode.get(b.dataset.bc); if (r) showItem(r, { noScroll: true }); }
  });

  /* ---------------- Camera scanner ---------------- */
  var V = $('#video'), CAM = $('#cam'), FRAME = $('#frame');
  var sc = { stream: null, track: null, running: false, timer: 0, busy: false, n: 0, miss: 0, native: null, reader: null, cv: document.createElement('canvas'), last: '', lastT: 0, zoomSteps: [1], zi: 0, torch: false };
  sc.ctx = sc.cv.getContext('2d', { willReadFrequently: true });

  function initDecoders() {
    if (sc.reader) return;
    try {
      var Z = window.ZXing, F = Z.BarcodeFormat, hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      sc.reader = new Z.MultiFormatReader(); sc.reader.setHints(hints);
    } catch (e) { console.warn('ZXing init', e); }
    if ('BarcodeDetector' in window) {
      var want = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code', 'data_matrix'];
      (BarcodeDetector.getSupportedFormats ? BarcodeDetector.getSupportedFormats() : Promise.resolve(want)).then(function (sup) {
        var f = want.filter(function (x) { return sup.indexOf(x) >= 0; });
        if (f.length) sc.native = new BarcodeDetector({ formats: f });
      }).catch(function () { });
    }
  }

  function setCamMsg(text, showBtn) {
    $('#camText').textContent = text; $('#btnStart').style.display = showBtn === false ? 'none' : '';
    $('#camMsg').classList.remove('hide');
  }

  function startCam() {
    if (sc.running) return Promise.resolve();
    initDecoders();
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamMsg('এই ব্রাউজারে ক্যামেরা চালানো যাচ্ছে না। Chrome (Android) বা Safari (iPhone) দিয়ে https লিংকে খুলুন।', false); return Promise.resolve();
    }
    setCamMsg('ক্যামেরা চালু হচ্ছে…', false);
    var tries = [
      { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { audio: false, video: { facingMode: 'environment' } },
      { audio: false, video: true }
    ];
    var p = Promise.reject(), i;
    tries.forEach(function (c) { p = p.catch(function (e) { if (e && e.name === 'NotAllowedError') throw e; return navigator.mediaDevices.getUserMedia(c); }); });
    return p.then(function (stream) {
      sc.stream = stream; sc.track = stream.getVideoTracks()[0];
      V.srcObject = stream; return V.play().catch(function () { });
    }).then(function () {
      var caps = {}; try { caps = sc.track.getCapabilities ? sc.track.getCapabilities() : {}; } catch (e) { }
      var adv = [];
      if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) adv.push({ focusMode: 'continuous' });
      if (adv.length) sc.track.applyConstraints({ advanced: adv }).catch(function () { });
      $('#btnTorch').hidden = !caps.torch;
      sc.zoomSteps = [1];
      if (caps.zoom) { var mx = caps.zoom.max; [2, 3].forEach(function (z) { if (z <= mx) sc.zoomSteps.push(z); }); }
      sc.zi = 0; $('#btnZoom').hidden = sc.zoomSteps.length < 2; $('#btnZoom').textContent = '1×';
      $('#camMsg').classList.add('hide');
      sc.running = true; store.set('camOK', 1); FRAME.classList.add('scanning'); schedule();
    }).catch(function (e) {
      sc.running = false; stopTracks();
      var m = 'ক্যামেরা চালু হয়নি।';
      if (e && e.name === 'NotAllowedError') m = 'ক্যামেরার অনুমতি দেওয়া হয়নি। ব্রাউজার/ফোন সেটিংস থেকে ক্যামেরা Allow করে আবার চেষ্টা করুন।';
      else if (e && e.name === 'NotFoundError') m = 'কোনো ক্যামেরা পাওয়া যায়নি।';
      else if (e && e.name === 'NotReadableError') m = 'ক্যামেরা অন্য অ্যাপ ব্যবহার করছে। সেটি বন্ধ করে আবার চেষ্টা করুন।';
      setCamMsg(m, true); $('#btnStart').textContent = '🔄 আবার চেষ্টা করুন';
    });
  }
  function stopTracks() {
    if (sc.stream) sc.stream.getTracks().forEach(function (t) { t.stop(); });
    sc.stream = null; sc.track = null; V.srcObject = null; sc.torch = false; $('#btnTorch').classList.remove('on');
  }
  function stopCam() { sc.running = false; clearTimeout(sc.timer); stopTracks(); }

  function schedule() { clearTimeout(sc.timer); if (sc.running) sc.timer = setTimeout(tick, 110); }

  function grab(full) {
    var vw = V.videoWidth, vh = V.videoHeight; if (!vw || !vh) return null;
    var sx = 0, sy = 0, sw = vw, sh = vh;
    if (!full) {
      var cr = CAM.getBoundingClientRect(), fr = FRAME.getBoundingClientRect();
      var s = Math.max(cr.width / vw, cr.height / vh), ox = (vw * s - cr.width) / 2, oy = (vh * s - cr.height) / 2;
      sx = (fr.left - cr.left + ox) / s; sy = (fr.top - cr.top + oy) / s; sw = fr.width / s; sh = fr.height / s;
      var px = sw * 0.06, py = sh * 0.12; sx -= px; sy -= py; sw += px * 2; sh += py * 2;
      sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    }
    var scale = Math.min(1, 1280 / sw);
    sc.cv.width = Math.round(sw * scale); sc.cv.height = Math.round(sh * scale);
    sc.ctx.drawImage(V, sx, sy, sw, sh, 0, 0, sc.cv.width, sc.cv.height);
    return sc.cv;
  }

  function decode(cv) {
    var tryZ = function () {
      if (!sc.reader) return null;
      try {
        var Z = window.ZXing, src = new Z.HTMLCanvasElementLuminanceSource(cv);
        var res = sc.reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src)));
        return res ? res.getText() : null;
      } catch (e) { return null; }
    };
    if (sc.native) {
      return sc.native.detect(cv).then(function (r) { if (r && r.length) return r[0].rawValue; return (sc.miss % 2 === 0) ? tryZ() : null; }).catch(tryZ);
    }
    return Promise.resolve(tryZ());
  }

  function tick() {
    if (!sc.running || sc.busy || V.readyState < 2) { schedule(); return; }
    sc.busy = true; sc.n++;
    var cv = grab(sc.n % 3 === 0); // every 3rd try looks at the whole picture
    if (!cv) { sc.busy = false; schedule(); return; }
    decode(cv).then(function (txt) {
      sc.busy = false;
      if (txt) { sc.miss = 0; onCode(String(txt).trim()); } else sc.miss++;
      schedule();
    });
  }

  function onCode(code) {
    var now = Date.now();
    if (code === sc.last && now - sc.lastT < 1800) { sc.lastT = now; return; }
    sc.last = code; sc.lastT = now;
    FRAME.classList.remove('scanning'); FRAME.classList.add('ok');
    setTimeout(function () { FRAME.classList.remove('ok'); if (sc.running) FRAME.classList.add('scanning'); }, 850);
    lookup(code, { noScroll: true });
  }

  $('#btnStart').addEventListener('click', startCam);
  $('#btnTorch').addEventListener('click', function () {
    if (!sc.track) return; sc.torch = !sc.torch;
    sc.track.applyConstraints({ advanced: [{ torch: sc.torch }] }).then(function () { $('#btnTorch').classList.toggle('on', sc.torch); }).catch(function () { sc.torch = false; toast('এই ফোনে ফ্ল্যাশ চালানো যায়নি'); });
  });
  $('#btnZoom').addEventListener('click', function () {
    if (!sc.track) return; sc.zi = (sc.zi + 1) % sc.zoomSteps.length; var z = sc.zoomSteps[sc.zi];
    sc.track.applyConstraints({ advanced: [{ zoom: z }] }).then(function () { $('#btnZoom').textContent = z + '×'; }).catch(function () { });
  });
  CAM.addEventListener('click', function (e) { // tap-to-refocus nudge
    if (e.target.closest('button') || !sc.track) return;
    try { sc.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () { }); } catch (x) { }
  });

  /* ---------------- Tabs ---------------- */
  var curView = 'scan';
  function showView(v) {
    curView = v;
    $$('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    if (v === 'scan') { if (store.get('camOK', 0) && !sc.running) startCam(); } else stopCam();
    window.scrollTo(0, 0);
    if (v === 'list') renderList();
  }
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.view); }); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (sc.running) { sc._resume = true; stopCam(); } }
    else if (sc._resume && curView === 'scan') { sc._resume = false; startCam(); }
  });

  /* ---------------- Display list ---------------- */
  var L = { pct: null, shown: 100, items: [] };
  function groupsInfo() {
    if (S.groups) return S.groups;
    var m = new Map();
    S.rows.forEach(function (r) { var g = m.get(r.pct); if (!g) { g = { pct: r.pct, rows: [], qty: 0, styles: new Set() }; m.set(r.pct, g); } g.rows.push(r); g.qty += r.qty; g.styles.add(r.key); });
    S.groups = Array.from(m.values()).sort(function (a, b) { return b.pct - a.pct; });
    return S.groups;
  }
  function renderList(reset) {
    if (!S.rows.length) return;
    var gs = groupsInfo();
    if (L.pct == null || !gs.some(function (g) { return g.pct === L.pct; })) L.pct = gs[0].pct;
    $('#groupTabs').style.gridTemplateColumns = 'repeat(' + gs.length + ',1fr)';
    $('#groupTabs').innerHTML = gs.map(function (g) {
      return '<button class="s' + (g.pct >= 50 ? '50' : g.pct > 0 ? '30' : '0') + (g.pct === L.pct ? ' on' : '') + '" data-pct="' + g.pct + '"><b>' + (g.pct > 0 ? pctTxt(g.pct) + '%' : 'নন-ডিসকাউন্ট') + '</b><small>' + fmt(g.qty) + ' পিস · ' + fmt(g.styles.size) + ' স্টাইল</small></button>';
    }).join('');
    var g = gs.filter(function (x) { return x.pct === L.pct; })[0];
    var q = norm($('#listSearch').value), cat = $('#listCat').value;
    // category options for the selected group
    var cm = new Map(); g.rows.forEach(function (r) { cm.set(r.mc, (cm.get(r.mc) || 0) + r.qty); });
    var sel = $('#listCat'), prev = sel.value, opts = '<option value="">সব ক্যাটাগরি</option>' +
      Array.from(cm.keys()).sort().map(function (k) { return '<option value="' + esc(k) + '">' + esc(k || '—') + ' (' + fmt(cm.get(k)) + ')</option>'; }).join('');
    if (sel.dataset.pct !== String(L.pct) || reset) { sel.innerHTML = opts; sel.dataset.pct = L.pct; sel.value = cm.has(prev) ? prev : ''; cat = sel.value; }
    var rows = g.rows.filter(function (r) {
      return (!cat || r.mc === cat) && (!q || (r.key + ' ' + r.mc + ' ' + r.cat + ' ' + r.barcode + ' ' + r.label).toUpperCase().indexOf(q) >= 0);
    });
    L.rows = rows;
    var m = new Map();
    rows.forEach(function (r) { var it = m.get(r.key); if (!it) { it = { r: r, qty: 0, sizes: [] }; m.set(r.key, it); } it.qty += r.qty; it.sizes.push(r); });
    L.items = Array.from(m.values());
    var pieces = rows.reduce(function (a, r) { return a + r.qty; }, 0);
    $('#listSummary').textContent = fmt(L.items.length) + ' স্টাইল-কালার · ' + fmt(rows.length) + ' বারকোড · ' + fmt(pieces) + ' পিস';
    var body = L.items.slice(0, L.shown).map(function (it) {
      var r = it.r;
      return '<div class="it"><div class="s">' + esc(r.style) + ' <span class="muted">' + esc(r.colour) + '</span></div><div class="q">' + fmt(it.qty) + '</div>' +
        '<div class="m">' + esc(r.mc) + ' · ' + esc(r.cat) + ' · MRP ৳' + fmt(r.mrp) + '</div><div class="m" style="text-align:right">পিস</div>' +
        '<div class="m" style="grid-column:1/-1">' + it.sizes.slice().sort(cmpSize).map(function (x) { return esc(cleanSize(x.size)) + ':' + fmt(x.qty); }).join(' · ') + '</div></div>';
    }).join('');
    $('#listBody').innerHTML = body || '<p class="muted">কিছু পাওয়া যায়নি।</p>';
    $('#listMore').hidden = L.items.length <= L.shown;
  }
  $('#groupTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-pct]'); if (!b) return; L.pct = +b.dataset.pct; L.shown = 100; $('#listCat').dataset.pct = ''; renderList(true); });
  $('#listSearch').addEventListener('input', function () { L.shown = 100; renderList(); });
  $('#listCat').addEventListener('change', function () { L.shown = 100; renderList(); });
  $('#listMore').addEventListener('click', function () { L.shown += 200; renderList(); });
  $('#listCsv').addEventListener('click', function () {
    if (!L.rows || !L.rows.length) { toast('এক্সপোর্ট করার মতো কিছু নেই'); return; }
    var head = ['Barcode', 'Style Code', 'Colour', 'Size', 'Master Category', 'Category', 'Label', 'Season (A02)', 'Stock', 'MRP', 'Discount %', 'Discounted Price', 'VAT %', 'Customer Price (incl. VAT)'];
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [head.join(',')].concat(L.rows.map(function (r) {
      return [r.barcode, r.style, r.colour, r.size, r.mc, r.cat, r.label, r.season, r.qty, r.mrp, r.pct, +r.after.toFixed(2), r.vatPct, Math.round(r.final)].map(q).join(',');
    }));
    download('﻿' + lines.join('\r\n'), 'display-' + (L.pct > 0 ? L.pct + 'pct' : 'no-discount') + '-' + S.stock.updated + '.csv', 'text/csv;charset=utf-8');
  });

  function download(text, name, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------------- Data tab ---------------- */
  var D = { stock: null, disc: null, dirty: false, stockDirty: false };
  function resetDraft() { D.disc = JSON.parse(JSON.stringify(S.disc)); D.stock = null; D.dirty = false; D.stockDirty = false; fillRules(); renderLists(); $('#stockPrev').textContent = ''; $('#discPrev').textContent = ''; }
  function fillRules() {
    var d = D.disc; d.yearRule = d.yearRule || { maxYear: 2024, pct: 50 }; d.vat = d.vat || { garments: 10, accessories: 7.5, accessoryLabels: [] };
    $('#ruleYear').value = d.yearRule.maxYear; $('#rulePct').value = d.yearRule.pct;
    $('#vatGar').value = d.vat.garments; $('#vatAcc').value = d.vat.accessories; $('#accLabels').value = (d.vat.accessoryLabels || []).join(', ');
  }
  function renderLists() {
    $('#listsBox').innerHTML = (D.disc.lists || []).map(function (l, i) {
      return '<div class="lrow"><span><b>' + pctTxt(l.pct) + '%</b> · ' + esc(l.name) + '<br><small class="muted">' + fmt((l.keys || []).length + (l.barcodes || []).length) + ' আইটেম · ' + esc(l.added || '') + '</small></span><button data-rm="' + i + '" aria-label="মুছুন">✕</button></div>';
    }).join('') || '<p class="muted small">কোনো ডিসকাউন্ট লিস্ট নেই।</p>';
  }
  function renderStatus() {
    var st = S.stock, d = S.disc;
    $('#statusCard').innerHTML = '<h3>বর্তমান ডেটা</h3><div class="muted small">' +
      'স্টক: <b>' + esc(st.updated) + '</b> · ' + fmt(st.count) + ' বারকোড · ' + fmt(st.pieces) + ' পিস · উৎস: ' + (S.src.stock === 'phone' ? 'এই ফোন' : 'GitHub') + '<br>' +
      'ডিসকাউন্ট: ' + esc(d.updated || '') + ' · উৎস: ' + (S.src.disc === 'phone' ? 'এই ফোন' : 'GitHub') + '<br>' +
      'নিয়ম: A02 ' + d.yearRule.maxYear + ' বা আগের → ' + d.yearRule.pct + '% · ' + (d.lists || []).map(function (l) { return pctTxt(l.pct) + '% লিস্ট'; }).join(', ') + '<br>' +
      'ভ্যাট: গার্মেন্টস/অন্যান্য ' + d.vat.garments + '% · একসেসোরিজ ' + d.vat.accessories + '%</div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="beepChk" ' + (beepOn() ? 'checked' : '') + '> স্ক্যানে বিপ শব্দ</label>';
    $('#beepChk').addEventListener('change', function (e) { store.set('beep', e.target.checked); });
  }
  $$('[data-pick]').forEach(function (b) { b.addEventListener('click', function () { $('#' + b.dataset.pick).click(); }); });

  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'libs/xlsx.min.js'; s.onload = res; s.onerror = function () { rej(new Error('Excel লাইব্রেরি লোড হয়নি (ইন্টারনেট লাগবে)')); }; document.head.appendChild(s); });
  }
  function readFile(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(new Uint8Array(r.result)); }; r.onerror = rej; r.readAsArrayBuffer(f); }); }
  function prev(el, msg, ok) { el.className = 'prev ' + (ok ? 'ok' : 'err'); el.textContent = msg; }

  $('#fileStock').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return; var el = $('#stockPrev'); prev(el, 'পড়া হচ্ছে… (কয়েক সেকেন্ড লাগতে পারে)', true);
    loadXLSX().then(function () { return readFile(f); }).then(function (buf) { return SailorParse.parseStock(window.XLSX, buf, f.name); })
      .then(function (st) { D.stock = st; D.stockDirty = true; prev(el, '✓ ' + fmt(st.count) + ' বারকোড, ' + fmt(st.pieces) + ' পিস পাওয়া গেছে (' + f.name + ')। নিচে "প্রয়োগ করুন"।', true); })
      .catch(function (err) { prev(el, err.message || String(err), false); });
    e.target.value = '';
  });
  $('#fileDisc').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return; var el = $('#discPrev'); var pct = parseFloat($('#listPct').value);
    if (!(pct > 0 && pct < 100)) { prev(el, 'সঠিক ডিসকাউন্ট % দিন', false); e.target.value = ''; return; }
    prev(el, 'পড়া হচ্ছে…', true);
    loadXLSX().then(function () { return readFile(f); }).then(function (buf) { return SailorParse.parseDiscountList(window.XLSX, buf, pct, pct + '% – ' + f.name.replace(/\.xlsx?$/i, '')); })
      .then(function (l) {
        D.disc.lists = (D.disc.lists || []).filter(function (x) { return x.pct !== l.pct; }); D.disc.lists.push(l); D.dirty = true; renderLists();
        prev(el, '✓ ' + fmt(l.keys.length + l.barcodes.length) + ' আইটেম যোগ হয়েছে (আগের ' + pctTxt(l.pct) + '% লিস্ট থাকলে বদলে গেছে)। নিচে "প্রয়োগ করুন"।', true);
      }).catch(function (err) { prev(el, err.message || String(err), false); });
    e.target.value = '';
  });
  $('#listsBox').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (!b) return; D.disc.lists.splice(+b.dataset.rm, 1); D.dirty = true; renderLists(); });
  function readRules() {
    var d = D.disc, n = function (id, dflt) { var v = parseFloat($(id).value); return isNaN(v) ? dflt : v; };
    var before = JSON.stringify([d.yearRule, d.vat]);
    d.yearRule = { maxYear: n('#ruleYear', 2024), pct: n('#rulePct', 50), note: (d.yearRule && d.yearRule.note) || '' };
    d.vat = { garments: n('#vatGar', 10), accessories: n('#vatAcc', 7.5), accessoryLabels: $('#accLabels').value.split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean) };
    if (before !== JSON.stringify([d.yearRule, d.vat])) D.dirty = true;
  }
  ['#ruleYear', '#rulePct', '#vatGar', '#vatAcc', '#accLabels'].forEach(function (id) { $(id).addEventListener('input', readRules); });

  $('#applyLocal').addEventListener('click', function () {
    readRules();
    if (!D.dirty && !D.stockDirty) { toast('কোনো পরিবর্তন নেই'); return; }
    var jobs = [];
    if (D.stockDirty && D.stock) jobs.push(idbSet('stock', D.stock));
    if (D.dirty) { D.disc.updated = new Date().toISOString().slice(0, 10); jobs.push(idbSet('discounts', D.disc)); }
    Promise.all(jobs).then(function () { return loadData(); }).then(function () { toast('✓ এই ফোনে আপডেট হয়েছে'); });
  });
  $('#dlStock').addEventListener('click', function () {
    var st = D.stock || S.stock; download(JSON.stringify(st), 'stock.json'); toast('stock.json ডাউনলোড হয়েছে');
  });
  $('#dlDisc').addEventListener('click', function () {
    readRules(); D.disc.updated = new Date().toISOString().slice(0, 10); download(JSON.stringify(D.disc), 'discounts.json'); toast('discounts.json ডাউনলোড হয়েছে');
  });
  $('#resetLocal').addEventListener('click', function () {
    if (!confirm('এই ফোনে রাখা ফাইল মুছে GitHub-এর ডেটা ব্যবহার করবেন?')) return;
    Promise.all([idbDel('stock'), idbDel('discounts')]).then(loadData).then(function () { toast('GitHub ডেটায় ফিরে এসেছে'); });
  });

  /* ---------------- Install (PWA) ---------------- */
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; renderInstall(); });
  window.addEventListener('appinstalled', function () { deferred = null; renderInstall(); });
  function renderInstall() {
    var el = $('#installBody');
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (standalone) el.innerHTML = '<p>✓ অ্যাপ ইনস্টল করা আছে।</p>';
    else if (deferred) { el.innerHTML = '<button class="primary" id="doInstall">⬇ অ্যাপ ইনস্টল করুন</button>'; $('#doInstall').onclick = function () { deferred.prompt(); deferred.userChoice.then(function () { deferred = null; renderInstall(); }); }; }
    else if (ios) el.innerHTML = '<ol class="how"><li>Safari-তে এই পেজ খুলুন (Chrome নয়)</li><li>নিচের <b>Share</b> (⬆︎) বোতামে চাপুন</li><li><b>Add to Home Screen</b> বাছুন → <b>Add</b></li></ol>';
    else el.innerHTML = '<ol class="how"><li>Chrome-এ উপরের <b>⋮</b> মেনু খুলুন</li><li><b>Install app</b> / <b>Add to Home screen</b> বাছুন</li></ol>';
  }

  /* ---------------- Boot ---------------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });
  renderInstall();
  loadData().then(function () { if (store.get('camOK', 0)) startCam(); });
  window.__app = { S: S, lookup: lookup, sc: sc };
})();
