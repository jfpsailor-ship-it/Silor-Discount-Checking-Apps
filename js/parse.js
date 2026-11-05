/* Excel -> compact JSON converters. Runs in the browser (SheetJS) and in Node (build step). */
(function (root) {
  'use strict';

  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase(); };
  var clean = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
  var num = function (v) {
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };

  function sheetRows(XLSX, buf) {
    var wb = XLSX.read(buf, { type: 'array', dense: true });
    return wb.SheetNames.map(function (name) {
      return { name: name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }) };
    });
  }

  // find the header row (first 15 rows) that contains all required names
  function findHeader(rows, required) {
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var h = rows[i].map(norm);
      var ok = required.every(function (alts) { return alts.some(function (a) { return h.indexOf(a) >= 0; }); });
      if (ok) return { index: i, headers: h };
    }
    return null;
  }
  function col(headers, alts) {
    for (var i = 0; i < alts.length; i++) { var k = headers.indexOf(alts[i]); if (k >= 0) return k; }
    return -1;
  }

  /* ---------- Stock report ---------- */
  function parseStock(XLSX, buf, fileName) {
    var sheets = sheetRows(XLSX, buf);
    var REQ = [['BARCODE'], ['MRP'], ['BALANCE']];
    var found = null, sh = null;
    for (var s = 0; s < sheets.length && !found; s++) {
      found = findHeader(sheets[s].rows, REQ); sh = sheets[s];
    }
    if (!found) throw new Error('স্টক ফাইলে BARCODE, MRP ও BALANCE কলাম পাওয়া যায়নি। সঠিক Stock Report ফাইল দিন।');
    var H = found.headers;
    var c = {
      barcode: col(H, ['BARCODE']), style: col(H, ['STYLE CODE', 'STYLE_CODE']),
      colour: col(H, ['COLOUR', 'COLOR']), size: col(H, ['SIZE']), mc: col(H, ['MASTER CATEGORY']),
      label: col(H, ['LABEL']), gender: col(H, ['GENDER']), cat: col(H, ['CATEGORY']),
      season: col(H, ['A02']), a01: col(H, ['A01']), qty: col(H, ['BALANCE']), mrp: col(H, ['MRP']),
      key: col(H, ['STYLE CODE & COLOUR', 'STYLE_CODE & COLOR'])
    };
    var get = function (r, k) { return k < 0 ? '' : r[k]; };
    var map = Object.create(null), out = [], pieces = 0, skipped = 0;
    for (var i = found.index + 1; i < sh.rows.length; i++) {
      var r = sh.rows[i];
      var bc = clean(get(r, c.barcode)).toUpperCase();
      if (!bc) { skipped++; continue; }
      var q = num(get(r, c.qty));
      if (map[bc] !== undefined) { out[map[bc]][10] += q; pieces += q; continue; }
      var style = clean(get(r, c.style));
      var colour = clean(get(r, c.colour));
      if (!style && c.key >= 0) { style = clean(get(r, c.key)); }
      var size = clean(get(r, c.size));
      map[bc] = out.length;
      out.push([bc, style, colour, size, clean(get(r, c.mc)), clean(get(r, c.label)), clean(get(r, c.gender)),
        clean(get(r, c.cat)), clean(get(r, c.season)), clean(get(r, c.a01)), q, num(get(r, c.mrp))]);
      pieces += q;
    }
    if (!out.length) throw new Error('স্টক ফাইলে কোনো পণ্য পাওয়া যায়নি।');
    return {
      version: 1, updated: new Date().toISOString().slice(0, 10), source: fileName || '',
      cols: ['barcode', 'style', 'colour', 'size', 'mc', 'label', 'gender', 'cat', 'season', 'a01', 'qty', 'mrp'],
      count: out.length, pieces: pieces, rows: out
    };
  }

  /* ---------- Discount list (style+colour list or barcode list) ---------- */
  function parseDiscountList(XLSX, buf, pct, name) {
    var sheets = sheetRows(XLSX, buf);
    var keys = Object.create(null), bcs = Object.create(null), nk = 0, nb = 0;
    sheets.forEach(function (sh) {
      var f = findHeader(sh.rows, [['STYLE_CODE & COLOR', 'STYLE_CODE & COLOUR', 'STYLE CODE & COLOUR', 'STYLE CODE & COLOR', 'BARCODE']]);
      if (!f) f = findHeader(sh.rows, [['STYLE_CODE', 'STYLE CODE'], ['COLOR', 'COLOUR']]);
      if (!f) return;
      var H = f.headers;
      var ck = col(H, ['STYLE_CODE & COLOR', 'STYLE_CODE & COLOUR', 'STYLE CODE & COLOUR', 'STYLE CODE & COLOR']);
      var cs = col(H, ['STYLE_CODE', 'STYLE CODE']), cc = col(H, ['COLOR', 'COLOUR']), cb = col(H, ['BARCODE']);
      for (var i = f.index + 1; i < sh.rows.length; i++) {
        var r = sh.rows[i], k = '';
        if (ck >= 0) k = norm(r[ck]);
        else if (cs >= 0) k = norm(norm(r[cs]) + ' ' + (cc >= 0 && norm(r[cc]) ? norm(r[cc]) : 'N/A'));
        if (k && !keys[k]) { keys[k] = 1; nk++; }
        if (ck < 0 && cs < 0 && cb >= 0) {
          var b = norm(r[cb]); if (b && !bcs[b]) { bcs[b] = 1; nb++; }
        }
      }
    });
    if (!nk && !nb) throw new Error('ডিসকাউন্ট ফাইলে STYLE_CODE & COLOR (বা BARCODE) কলাম পাওয়া যায়নি।');
    return { pct: Number(pct), name: name || (pct + '% ডিসকাউন্ট লিস্ট'), added: new Date().toISOString().slice(0, 10),
      keys: Object.keys(keys), barcodes: Object.keys(bcs) };
  }

  function defaultDiscounts() {
    return {
      version: 1, updated: new Date().toISOString().slice(0, 10),
      yearRule: { maxYear: 2024, pct: 50, note: 'A02 (সিজন) এর বছর এই বছর বা তার আগের হলে' },
      vat: { garments: 10, accessories: 7.5, accessoryLabels: ['ACCESSORIES', 'FOOTWEAR ACCESSORIES'] },
      lists: []
    };
  }

  var api = { norm: norm, parseStock: parseStock, parseDiscountList: parseDiscountList, defaultDiscounts: defaultDiscounts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SailorParse = api;
})(typeof self !== 'undefined' ? self : this);
