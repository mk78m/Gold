import React, { useState, useEffect, useRef, useCallback } from "react";

/* ================= تنظیمات و ثابت‌ها ================= */
const SRC = [
  { n: "TGJU", u: "https://call4.tgju.org/ajax.json", json: 1 },
  { n: "AlanChand", u: "https://alanchand.com/gold-price/18ayar" },
  { n: "Tala.ir", u: "https://www.tala.ir/" },
  { n: "Talasea", u: "https://www.talasea.ir/" },
  { n: "Gold.ir", u: "https://www.gold.ir/" },
];
/* قیمت‌های واقعی ۹ مهر ۱۴۰۵ (میانگین چند سایت)؛ فقط وقتی هیچ منبع زنده‌ای در دسترس نباشد */
const SNAP = { g18: { p: 25358000 }, ons: { p: 4156.6 }, usd: { p: 254700 }, emami: { p: 259980000 } };
const GRAM = 0.75 / 31.1035, HZ = 5;

/* ================= ابزارهای کمکی ================= */
const f2e = (s) => String(s).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const num = (v) => { const n = parseFloat(f2e(v).replace(/[,٬\s]/g, "")); return isNaN(n) ? null : n; };
const fa = (n, d = 0) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("fa-IR", { maximumFractionDigits: d }));
const pct = (n, d = 2) => (n == null || isNaN(n) ? "—" : (n > 0 ? "+" : "") + fa(n, d) + "٪");
const fd = (t) => new Date(t).toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const cls = (n) => (n > 0 ? "up" : n < 0 ? "dn" : "");
const med = (a) => (a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);

/* ================= دریافت داده ================= */
async function getText(url, proxy, ms = 6000) {
  const list = (proxy ? [(u) => proxy + encodeURIComponent(u)] : []).concat([
    (u) => u,
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  ]);
  let err;
  for (const f of list) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(f(url), { signal: c.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) { err = e; } finally { clearTimeout(t); }
  }
  throw err;
}
function parseLive(cur) {
  const K = { g18: "geram18", emami: "sekee", usd: "price_dollar_rl", ons: "ons" }, o = {};
  for (const id in K) {
    const e = cur[K[id]]; if (!e) continue;
    const p = num(e.p); if (p == null) continue;
    const u = id === "ons" ? 1 : 10, m = num(e.dp) || 0, s = e.dt === "low" ? -1 : 1, pv = p - s * m;
    o[id] = { p: p / u, ch: pv ? (s * m / pv) * 100 : null };
  }
  return o;
}
function extract(html, ref) {
  const lo = ref * 0.88, hi = ref * 1.12;
  const tx = f2e(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
  const re = /طلا[یي\s]*(?:گرمی\s*)?18\s*عیار/g; let m;
  while ((m = re.exec(tx))) {
    const w = tx.slice(m.index, m.index + 160);
    for (const x of w.matchAll(/\d{1,3}(?:[,٬]\d{3}){2,}|\d{7,10}/g)) {
      const v = num(x[0]);
      for (const c of [v, v / 10]) if (c >= lo && c <= hi) return c;
    }
  }
  return null;
}
async function scrape(s, ref, proxy) {
  try {
    const t = await getText(s.u, proxy); let p = null, ex = null;
    if (s.json) { const j = JSON.parse(t); ex = parseLive(j.current || j); p = ex.g18 && ex.g18.p; } else p = extract(t, ref);
    if (p == null) throw new Error("قیمت پیدا نشد");
    if (Math.abs(p / ref - 1) > 0.15) throw new Error("خارج از بازه");
    return { n: s.n, p, ex, ok: true };
  } catch (e) { return { n: s.n, ok: false, err: String(e.message || e).slice(0, 36) }; }
}
/* پشتیبان: جست‌وجوی وب با Claude وقتی خواندن مستقیم سایت‌ها ممکن نباشد (در پیش‌نمایش claude.ai) */
async function askClaude() {
  const q = 'قیمت لحظه‌ای امروز هر گرم طلای ۱۸ عیار را از ۴ سایت ایرانی مختلف (مثل tgju.org، alanchand.com، eghtesadonline.com، tala.ir) جست‌وجو کن. فقط و فقط یک JSON برگردان، بدون هیچ متن دیگر: {"sources":[{"site":"نام سایت","price_toman":عدد}],"usd_toman":عدد,"ounce_usd":عدد,"emami_toman":عدد}';
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, tools: [{ type: "web_search_20250305", name: "web_search" }], messages: [{ role: "user", content: q }] }),
  });
  const j = await r.json();
  const t = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(t.replace(/```json|```/g, "").match(/\{[\s\S]*\}/)[0]);
}
async function liveCmp() {
  const [b, n] = await Promise.all([
    fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT").then((r) => r.json()),
    fetch("https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls").then((r) => r.json()),
  ]);
  const s = n.stats["usdt-rls"], o = { p: +b.lastPrice, ch: +b.priceChangePercent }, u = { p: +s.latest / 10, ch: +s.dayChange };
  if (!(o.p > 0 && u.p > 0)) throw 0;
  return { ons: o, usd: u, g18: { p: o.p * u.p * GRAM, ch: ((1 + o.ch / 100) * (1 + u.ch / 100) - 1) * 100 } };
}
async function buildRaw() {
  const now = Math.floor(Date.now() / 1e3);
  const [b, n] = await Promise.all([
    fetch("https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1d&limit=400").then((r) => r.json()),
    fetch("https://api.nobitex.ir/market/udf/history?symbol=USDTIRT&resolution=D&from=" + (now - 420 * 86400) + "&to=" + now).then((r) => r.json()),
  ]);
  if (n.s !== "ok") throw 0;
  const day = (t) => new Date(t).toISOString().slice(0, 10), fx = {};
  n.t.forEach((t, i) => (fx[day(t * 1e3)] = +n.c[i]));
  let last = null; const out = [];
  b.forEach((r) => { const q = fx[day(r[0])] || last; if (!q) return; last = q; const k = (q * GRAM) / 10; out.push({ t: r[0], o: +r[1] * k, h: +r[2] * k, l: +r[3] * k, c: +r[4] * k }); });
  return out;
}

/* ================= اندیکاتورها ================= */
const sma = (a, n) => a.map((_, i) => (i < n - 1 ? null : a.slice(i - n + 1, i + 1).reduce((x, y) => x + y, 0) / n));
function ema(a, n) { const k = 2 / (n + 1), r = [a[0]]; for (let i = 1; i < a.length; i++) r.push(a[i] * k + r[i - 1] * (1 - k)); return r; }
function rsi(a, n = 14) {
  const r = Array(a.length).fill(null); if (a.length <= n) return r;
  let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; d > 0 ? (g += d) : (l -= d); }
  g /= n; l /= n; r[n] = 100 - 100 / (1 + (l ? g / l : 1e9));
  for (let i = n + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) - Math.min(d, 0)) / n; r[i] = 100 - 100 / (1 + (l ? g / l : 1e9)); }
  return r;
}
function calc(h) {
  const c = h.map((k) => k.c), f = ema(c, 12), s = ema(c, 26), m = f.map((x, i) => x - s[i]), sg = ema(m, 9);
  const mid = sma(c, 20), bb = mid.map((m0, i) => { if (m0 == null) return null; const w = c.slice(i - 19, i + 1), sd = Math.sqrt(w.reduce((x, y) => x + (y - m0) ** 2, 0) / 20); return { u: m0 + 2 * sd, l: m0 - 2 * sd }; });
  const K = h.map((_, i) => { if (i < 13) return null; let lo = 1e99, hi = -1e99; for (let j = i - 13; j <= i; j++) { lo = Math.min(lo, h[j].l); hi = Math.max(hi, h[j].h); } return hi > lo ? ((c[i] - lo) / (hi - lo)) * 100 : 50; });
  const Dd = K.map((_, i) => (i < 15 ? null : (K[i] + K[i - 1] + K[i - 2]) / 3));
  const tr = h.map((k, i) => (i ? Math.max(k.h - k.l, Math.abs(k.h - c[i - 1]), Math.abs(k.l - c[i - 1])) : k.h - k.l));
  const atr = tr.map((_, i) => (i < 14 ? null : tr.slice(i - 13, i + 1).reduce((a, b) => a + b, 0) / 14));
  return { c, e20: ema(c, 20), e50: ema(c, 50), rs: rsi(c), mf: m, ms: sg, mh: m.map((x, i) => x - sg[i]), bb, K, Dd, atr };
}
function scoreAt(A, i, bub) {
  const L = A.c[i], e20 = A.e20[i], e50 = A.e50[i], r = A.rs[i], b = A.bb[i], st = A.Dd[i], pb = (L - b.l) / (b.u - b.l);
  const rows = [
    { n: "روند (EMA ۲۰ و ۵۰)", v: L > e20 && e20 > e50 ? "صعودی" : L < e20 && e20 < e50 ? "نزولی" : "مختلط", s: ((L > e20 ? 1 : -1) + (e20 > e50 ? 1 : -1)) / 2 },
    { n: "RSI (۱۴)", v: fa(r, 0), s: r < 30 ? 0.8 : r > 70 ? -0.8 : ((r - 50) / 50) * 0.6 },
    { n: "MACD", v: A.mh[i] > 0 ? "مثبت" : "منفی", s: clamp(((A.mh[i] / L) * 100) / 0.5, -1, 1) },
    { n: "بولینگر", v: fa(pb * 100, 0) + "٪ باند", s: pb > 1 ? -1 : pb < 0 ? 1 : (0.5 - pb) * 0.6 },
    { n: "استوکاستیک", v: fa(st, 0), s: st < 20 ? 0.8 : st > 80 ? -0.8 : ((st - 50) / 50) * 0.4 },
  ];
  if (bub != null) rows.push({ n: "حباب نسبت به اونس×دلار", v: pct(bub * 100, 1), s: clamp(-(bub - 0.03) / 0.1, -1, 1) });
  const score = Math.round((rows.reduce((a, x) => a + x.s, 0) / rows.length) * 100);
  return { rows, score, label: score >= 25 ? "خرید" : score <= -25 ? "فروش" : "نگه‌دار" };
}
function backtest(A) {
  const c = A.c, n = c.length; let N = 0, hit = 0, sum = 0, up = 0, tot = 0;
  for (let i = 50; i < n - HZ; i++) {
    const r = c[i + HZ] / c[i] - 1; tot++; if (r > 0) up++;
    const sc = scoreAt(A, i, null).score; if (sc > -25 && sc < 25) continue;
    const g = sc > 0 ? r : -r; N++; sum += g; if (g > 0) hit++;
  }
  const p = N ? hit / N : 0;
  return { N, p, ci: N ? 1.96 * Math.sqrt((p * (1 - p)) / N) : 0, avg: N ? (sum / N) * 100 : 0, base: tot ? up / tot : 0 };
}
function levels(A, h, P, lb) {
  const n = h.length, at = A.atr[n - 1];
  if (lb === "خرید") return { lb, en: P, st: P - 1.5 * at, tg: P + 3 * at, t: ["ورود", "حد ضرر", "هدف"] };
  if (lb === "فروش") return { lb, en: P, st: P + 1.5 * at, tg: P - 3 * at, t: ["فروش در", "حد ضرر", "هدف خرید مجدد"] };
  const lo = Math.min(...h.slice(-14).map((k) => k.l)), hi = Math.max(...h.slice(-20).map((k) => k.h));
  return { lb, en: Math.min(P, A.e20[n - 1]), st: lo - 0.5 * at, tg: hi, t: ["ورود در اصلاح", "حد ضرر", "هدف"] };
}

/* ================= بارگذاری و تحلیل ================= */
async function loadAll(proxy, cache) {
  let cmp = null; try { cmp = await liveCmp(); } catch (e) {}
  const ref = cmp ? cmp.g18.p : SNAP.g18.p;
  let res = await Promise.all(SRC.map((s) => scrape(s, ref, proxy)));
  let ok = res.filter((r) => r.ok), X = (ok.find((r) => r.ex) || {}).ex || null, ai = false;
  if (ok.length < 2) {
    try {
      const a = await askClaude();
      const rows = (a.sources || []).map((s) => ({ n: String(s.site).slice(0, 24), p: num(s.price_toman), ok: true })).filter((r) => r.p && Math.abs(r.p / ref - 1) <= 0.15);
      if (rows.length >= 2) {
        ai = true; res = res.filter((r) => !r.ok).concat(rows); ok = ok.concat(rows);
        if (!X) X = { ons: +a.ounce_usd > 0 ? { p: +a.ounce_usd } : null, usd: +a.usd_toman > 0 ? { p: +a.usd_toman } : null, emami: +a.emami_toman > 0 ? { p: +a.emami_toman } : null };
      }
    } catch (e) {}
  }
  const prices = ok.map((r) => r.p).sort((a, b) => a - b);
  let mode, P, spread = null;
  if (prices.length) { mode = "live"; P = med(prices); spread = ((prices[prices.length - 1] - prices[0]) / P) * 100; }
  else if (cmp) { mode = "cmp"; P = cmp.g18.p; } else { mode = "snap"; P = SNAP.g18.p; }
  const base = X || cmp || SNAP;
  const ons = base.ons || (cmp && cmp.ons) || SNAP.ons, usd = base.usd || (cmp && cmp.usd) || SNAP.usd, emami = base.emami || (cmp ? null : SNAP.emami);
  const ch = X && X.g18 ? X.g18.ch : cmp ? cmp.g18.ch : null;
  if (!cache.raw.length || Date.now() - cache.t > 18e5) { try { cache.raw = await buildRaw(); cache.t = Date.now(); } catch (e) {} }
  const lc = cache.raw.length && cache.raw[cache.raw.length - 1].c;
  const k = mode !== "snap" && lc ? P / lc : 1;
  const h = k < 0.9 || k > 1.1 ? [] : cache.raw.map((r) => ({ t: r.t, o: r.o * k, h: r.h * k, l: r.l * k, c: r.c * k }));
  const A = h.length >= 70 && mode !== "snap" ? calc(h) : null;
  const bub = mode === "live" && ons && usd ? P / (ons.p * usd.p * GRAM) - 1 : null;
  const sig = A ? scoreAt(A, h.length - 1, bub) : null;
  return { mode, ai, P, spread, ons, usd, emami, ch, res, nOk: ok.length, h, A, sig, bt: A ? backtest(A) : null, lv: sig ? levels(A, h, P, sig.label) : null, t: new Date() };
}

/* ================= رسم نمودار ================= */
function draw(cv, S, range, hov) {
  const A = S.A, r = cv.getBoundingClientRect(), dp = window.devicePixelRatio || 1;
  cv.width = r.width * dp; cv.height = r.height * dp;
  const x = cv.getContext("2d"); x.scale(dp, dp);
  const W = r.width, Hh = r.height, N = Math.min(range, S.h.length), o = S.h.length - N;
  const P = { l: 8, r: 64, t: 8, b: 20 }, gap = 10, inner = Hh - P.t - P.b - gap * 3, hs = [0.5, 0.17, 0.17, 0.16].map((f) => f * inner);
  const tp = [P.t]; for (let i = 0; i < 3; i++) tp.push(tp[i] + hs[i] + gap);
  const st = (W - P.l - P.r) / N, X = (i) => P.l + (i + 0.5) * st, s = S.h.slice(o);
  const cs = getComputedStyle(cv), col = (q) => cs.getPropertyValue(q).trim();
  const L = S.lv; let mn = 1e99, mx = -1e99;
  s.forEach((k, i) => { mn = Math.min(mn, k.l); mx = Math.max(mx, k.h); const b = A.bb[o + i]; if (b) { mn = Math.min(mn, b.l); mx = Math.max(mx, b.u); } });
  if (L) [L.en, L.st, L.tg].forEach((v) => { mn = Math.min(mn, v); mx = Math.max(mx, v); });
  const pd = (mx - mn) * 0.04; mn -= pd; mx += pd;
  const Y = (v, p, a, b) => tp[p] + (1 - (v - a) / (b - a)) * hs[p], YP = (v) => Y(v, 0, mn, mx);
  x.font = "11px Tahoma,sans-serif"; x.lineWidth = 1;
  const txt = (t, px, py, al, c) => { x.fillStyle = c || col("--mu"); x.textAlign = al; x.fillText(t, px, py); };
  const line = (arr, f, c, w, dash) => { x.beginPath(); let on = false; arr.forEach((q, i) => { if (q == null) return; on ? x.lineTo(X(i), f(q)) : x.moveTo(X(i), f(q)); on = true; }); x.strokeStyle = c; x.lineWidth = w; x.setLineDash(dash || []); x.stroke(); x.setLineDash([]); };
  const grid = (vals, f) => { x.strokeStyle = col("--bd"); x.lineWidth = 1; vals.forEach((v) => { const y = f(v); x.beginPath(); x.moveTo(P.l, y); x.lineTo(W - P.r, y); x.stroke(); txt(v < 1e4 ? fa(v) : fa(v / 1e6, 1) + "M", W - P.r + 6, y + 4, "left"); }); };
  grid([0, 1, 2, 3, 4].map((i) => mn + ((mx - mn) * i) / 4), YP);
  x.beginPath(); s.forEach((_, i) => { const b = A.bb[o + i]; if (!b) return; i ? x.lineTo(X(i), YP(b.u)) : x.moveTo(X(i), YP(b.u)); });
  for (let i = s.length - 1; i >= 0; i--) { const b = A.bb[o + i]; if (b) x.lineTo(X(i), YP(b.l)); }
  x.fillStyle = col("--sh"); x.globalAlpha = 0.7; x.fill(); x.globalAlpha = 1;
  line(s.map((_, i) => A.bb[o + i] && A.bb[o + i].u), YP, col("--mu"), 1); line(s.map((_, i) => A.bb[o + i] && A.bb[o + i].l), YP, col("--mu"), 1);
  const bw = Math.max(1, st * 0.62);
  s.forEach((k, i) => { const c = k.c >= k.o ? col("--up") : col("--dn"); x.strokeStyle = c; x.fillStyle = c; x.lineWidth = 1; x.beginPath(); x.moveTo(X(i), YP(k.h)); x.lineTo(X(i), YP(k.l)); x.stroke(); const y1 = YP(Math.max(k.o, k.c)), y2 = YP(Math.min(k.o, k.c)); x.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1)); });
  line(A.e20.slice(o), YP, col("--au"), 1.6); line(A.e50.slice(o), YP, col("--bl"), 1.6);
  if (L) [[L.en, "--up", "ورود"], [L.tg, "--up", "هدف"], [L.st, "--dn", "ضرر"]].forEach((q) => { const y = YP(q[0]); x.beginPath(); x.moveTo(P.l, y); x.lineTo(W - P.r, y); x.strokeStyle = col(q[1]); x.setLineDash([5, 4]); x.lineWidth = 1.2; x.stroke(); x.setLineDash([]); txt(q[2], P.l + 2, y - 3, "left", col(q[1])); });
  txt("قیمت · EMA · بولینگر", W - P.r - 4, tp[0] + 12, "right");
  grid([30, 50, 70], (v) => Y(v, 1, 0, 100)); line(A.rs.slice(o), (v) => Y(v, 1, 0, 100), col("--tx"), 1.4); txt("RSI", W - P.r - 4, tp[1] + 12, "right");
  const mm = Math.max(...A.mf.slice(o).concat(A.ms.slice(o), A.mh.slice(o)).map(Math.abs)) * 1.1, YM = (v) => Y(v, 2, -mm, mm);
  x.strokeStyle = col("--bd"); x.beginPath(); x.moveTo(P.l, YM(0)); x.lineTo(W - P.r, YM(0)); x.stroke();
  A.mh.slice(o).forEach((v, i) => { x.fillStyle = v >= 0 ? col("--up") : col("--dn"); x.globalAlpha = 0.55; x.fillRect(X(i) - bw / 2, Math.min(YM(0), YM(v)), bw, Math.abs(YM(v) - YM(0))); x.globalAlpha = 1; });
  line(A.mf.slice(o), YM, col("--bl"), 1.3); line(A.ms.slice(o), YM, col("--au"), 1.3); txt("MACD", W - P.r - 4, tp[2] + 12, "right");
  grid([20, 50, 80], (v) => Y(v, 3, 0, 100)); line(A.K.slice(o), (v) => Y(v, 3, 0, 100), col("--bl"), 1.2); line(A.Dd.slice(o), (v) => Y(v, 3, 0, 100), col("--au"), 1.2); txt("استوکاستیک", W - P.r - 4, tp[3] + 12, "right");
  [0, Math.floor(N / 2), N - 1].forEach((i) => txt(fd(s[i].t), clamp(X(i), 50, W - P.r - 30), Hh - 5, "center"));
  if (hov >= 0 && hov < N) { x.strokeStyle = col("--mu"); x.setLineDash([3, 3]); x.beginPath(); x.moveTo(X(hov), P.t); x.lineTo(X(hov), Hh - P.b); x.stroke(); x.setLineDash([]); }
}

/* ================= رابط کاربری ================= */
const CSS = `
.gd{--bg:#f3f4f2;--cd:#fff;--tx:#17201e;--mu:#6b7774;--bd:#e0e4e2;--au:#b07d12;--up:#0f8a5f;--dn:#c23b2d;--sh:#eef1ef;--bl:#2f6fdd;background:var(--bg);color:var(--tx);font:15px/1.7 Vazirmatn,Tahoma,"Segoe UI",sans-serif;min-height:100vh;direction:rtl}
@media(prefers-color-scheme:dark){.gd{--bg:#0b1412;--cd:#121f1c;--tx:#e9f1ef;--mu:#8da29d;--bd:#22372f;--au:#e2b84d;--up:#35d296;--dn:#ff7a68;--sh:#182a26;--bl:#6aa0ff}}
.gd *{box-sizing:border-box}
.gd header{position:sticky;top:0;z-index:5;background:var(--cd);border-bottom:1px solid var(--bd)}
.gd .hd{max-width:1100px;margin:0 auto;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.gd h1{font-size:17px;margin:0;display:flex;align-items:center;gap:8px}.gd h1:before{content:"";width:10px;height:10px;border-radius:50%;background:var(--au)}
.gd h2{font-size:14px;margin:0 0 8px;color:var(--mu);font-weight:600}
.gd .mu{color:var(--mu);font-size:12px}
.gd main{max-width:1100px;margin:0 auto;padding:14px;display:grid;gap:14px}
.gd .card{background:var(--cd);border:1px solid var(--bd);border-radius:14px;padding:16px;min-width:0}
.gd .two{display:grid;gap:14px;grid-template-columns:minmax(0,1fr)}
@media(min-width:800px){.gd .two{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)}.gd .eq{grid-template-columns:1fr 1fr}}
.gd button{font:inherit;font-size:13px;background:var(--sh);color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:4px 12px;cursor:pointer}
.gd button:focus-visible,.gd input:focus-visible{outline:2px solid var(--au);outline-offset:2px}
.gd button.on{background:var(--tx);color:var(--cd);border-color:var(--tx)}
.gd .banner{background:var(--sh);border:1px solid var(--au);border-radius:10px;padding:8px 12px;font-size:13px}
.gd .px{font-size:42px;font-weight:800;line-height:1.3}
.gd .up{color:var(--up)}.gd .dn{color:var(--dn)}.gd .nt{color:var(--au)}
.gd .chips{display:flex;gap:6px;flex-wrap:wrap}.gd .chip{font-size:12px;padding:1px 10px;border-radius:99px;background:var(--sh)}
.gd .sub3{display:flex;gap:22px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--bd)}
.gd .sub3 b{display:block;font-size:15px}.gd .sub3 span{font-size:12px}
.gd .lab{font-size:36px;font-weight:800;line-height:1.3}
.gd .meter{direction:ltr;position:relative;height:8px;border-radius:4px;margin:12px 0 4px;background:linear-gradient(90deg,var(--dn),var(--sh) 42%,var(--sh) 58%,var(--up))}
.gd .meter i{position:absolute;top:-5px;width:4px;height:18px;border-radius:2px;background:var(--tx);transform:translateX(-50%)}
.gd .ml{direction:ltr;display:flex;justify-content:space-between;font-size:11px;color:var(--mu)}
.gd .lv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.gd .lv div{background:var(--sh);border-radius:10px;padding:8px 10px}.gd .lv small{display:block;color:var(--mu);font-size:11px}.gd .lv b{font-size:14px}
.gd .acc{margin-top:12px;font-size:12.5px;color:var(--mu);border-top:1px solid var(--bd);padding-top:10px}
.gd .tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.gd .lg{font-size:12px;color:var(--mu);display:flex;gap:12px;flex-wrap:wrap;margin-inline-start:auto}
.gd .cvw{position:relative}.gd canvas{width:100%;height:560px;display:block;touch-action:pan-y}
@media(min-width:800px){.gd canvas{height:660px}}
.gd .tip{position:absolute;top:6px;inset-inline-start:6px;font-size:12px;background:var(--cd);border:1px solid var(--bd);border-radius:8px;padding:4px 10px;line-height:1.6;pointer-events:none}
.gd table{width:100%;border-collapse:collapse;font-size:14px}.gd td{padding:7px 4px;border-bottom:1px solid var(--bd)}.gd tr:last-child td{border:0}.gd td:last-child{text-align:end;font-weight:600}
.gd input{width:100%;font:inherit;direction:ltr;background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:6px;padding:6px}
.gd footer{padding:4px 14px 24px;text-align:center;color:var(--mu);font-size:12px;max-width:900px;margin:0 auto}
`;

export default function GoldDashboard() {
  const [S, setS] = useState(null);
  const [range, setRange] = useState(90);
  const [hov, setHov] = useState(-1);
  const [busy, setBusy] = useState(true);
  const [proxy, setProxy] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const cv = useRef(null), cache = useRef({ raw: [], t: 0 }), px = useRef("");
  px.current = proxy;

  const load = useCallback(async () => {
    setBusy(true);
    try { setS(await loadAll(px.current, cache.current)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 180000); return () => clearInterval(id); }, [load]);
  useEffect(() => { if (S && S.A && cv.current) draw(cv.current, S, range, hov); }, [S, range, hov]);
  useEffect(() => {
    const f = () => S && S.A && cv.current && draw(cv.current, S, range, hov);
    window.addEventListener("resize", f); return () => window.removeEventListener("resize", f);
  }, [S, range, hov]);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), N = Math.min(range, S.h.length);
    setHov(clamp(Math.floor((e.clientX - r.left - 8) / ((r.width - 72) / N)), 0, N - 1));
  };

  let body;
  if (!S) body = <main><div className="card">در حال دریافت قیمت از چند منبع…</div></main>;
  else {
    const { mode, P, sig, bt, lv, A, h } = S, n = h.length, cg = (d) => (n > d ? (h[n - 1].c / h[n - 1 - d].c - 1) * 100 : null);
    let msg = "";
    if (mode === "snap") msg = "هیچ منبع قیمتی در دسترس نبود. قیمت‌ها آخرین نرخ ثبت‌شده در ۹ مهر ۱۴۰۵ است و تحلیل غیرفعال است. در تنظیمات پروکسی وارد کنید.";
    else if (mode === "cmp") msg = "هیچ‌کدام از سایت‌ها خوانده نشد؛ قیمت محاسباتی (اونس × دلار تتر) نشان داده می‌شود و ممکن است با بازار چند درصد فرق داشته باشد.";
    else if (!A) msg = "قیمت زنده دریافت شد ولی تاریخچه‌ی کندلی (Binance و نوبیتکس) در این محیط در دسترس نیست؛ نمودار و تحلیل غیرفعال‌اند. در پروژه‌ی خودتان یا با پروکسی اجرا کنید.";
    const chip = (a, v) => (v == null ? null : <span className="chip">{a} <b className={cls(v)}>{pct(v)}</b></span>);
    const sub = [["اونس (دلار)", S.ons, 2], ["دلار (تومان)", S.usd, 0], ["سکه امامی", S.emami, 0]].filter((q) => q[1]);
    const df = (v) => pct((v / P - 1) * 100, 1);
    const buy = sig ? sig.rows.filter((x) => x.s > 0.25).length : 0, sell = sig ? sig.rows.filter((x) => x.s < -0.25).length : 0;
    const rr = lv ? Math.abs(lv.tg - lv.en) / Math.abs(lv.en - lv.st) : 0;
    const hs = hov >= 0 && A ? Math.min(range, n) : 0, hi = A && hov >= 0 && hov < hs ? n - hs + hov : -1;
    body = (
      <main>
        {msg && <div className="banner">{msg}</div>}
        <section className="two">
          <div className="card">
            <h2>قیمت هر گرم طلای ۱۸ عیار (تومان)</h2>
            <div className="px">{fa(P)}</div>
            <div className="chips">
              {chip("امروز", S.ch)}{A && chip("هفته", cg(7))}{A && chip("ماه", cg(30))}
              {S.spread != null && <span className="chip">اختلاف منابع <b>{fa(S.spread, 2)}٪</b></span>}
            </div>
            <div className="sub3">
              {sub.map((q) => (<div key={q[0]}><span className="mu">{q[0]}</span><b>{fa(q[1].p, q[2])}</b>{q[1].ch != null && <span className={cls(q[1].ch)}>{pct(q[1].ch)}</span>}</div>))}
            </div>
          </div>
          <div className="card">
            <h2>تحلیل (میانگین اندیکاتورها)</h2>
            {sig ? (<>
              <div className={"lab " + (sig.label === "خرید" ? "up" : sig.label === "فروش" ? "dn" : "nt")}>{sig.label}</div>
              <div className="meter"><i style={{ left: clamp(50 + sig.score / 2, 2, 98) + "%" }} /></div>
              <div className="ml"><span>فروش</span><span>نگه‌دار</span><span>خرید</span></div>
              <div className="mu" style={{ marginTop: 6 }}>{fa(buy)} اندیکاتور خرید · {fa(sig.rows.length - buy - sell)} خنثی · {fa(sell)} فروش — میانگین امتیاز {fa(sig.score)} از ۱۰۰</div>
              <div className="lv">
                {[[lv.t[0], lv.en, lv.lb === "نگه‌دار" && lv.en < P ? df(lv.en) : ""], [lv.t[1], lv.st, df(lv.st)], [lv.t[2], lv.tg, df(lv.tg)]].map((q) => (<div key={q[0]}><small>{q[0]}</small><b>{fa(q[1])}</b> <small>{q[2]}</small></div>))}
              </div>
              <div className="acc"><b>دقت تحلیل:</b> در {fa(bt.N)} سیگنال گذشته، {fa(bt.p * 100, 0)}٪ (±{fa(bt.ci * 100, 0)}) در {fa(HZ)} روز بعد درست از آب درآمد؛ میانگین بازده {pct(bt.avg, 1)}. شاخص مقایسه: {fa(bt.base * 100, 0)}٪ روزها صعودی بوده‌اند. نسبت سود به زیان این نقطه‌ها {fa(rr, 1)} به ۱ است. {bt.N < 20 ? "نمونه کم است و نتیجه قابل اتکا نیست." : bt.p - bt.ci > bt.base + 0.02 ? "برتری آماری دارد، ولی تضمین نیست." : "برتری آماری روشنی نسبت به شانس نشان نمی‌دهد؛ با احتیاط استفاده کنید."}</div>
            </>) : (<div className="mu">برای تحلیل به قیمت زنده و تاریخچه نیاز است.</div>)}
          </div>
        </section>
        {A && (
          <section className="card">
            <div className="tools">
              {[[30, "۱ ماه"], [90, "۳ ماه"], [180, "۶ ماه"], [365, "۱ سال"]].map((q) => (<button key={q[0]} className={range === q[0] ? "on" : ""} onClick={() => setRange(q[0])}>{q[1]}</button>))}
              <div className="lg"><span style={{ color: "var(--au)" }}>■ EMA20</span><span style={{ color: "var(--bl)" }}>■ EMA50</span><span>■ بولینگر</span><span className="up">■ ورود/هدف</span><span className="dn">■ حد ضرر</span></div>
            </div>
            <div className="cvw">
              <canvas ref={cv} aria-label="نمودار کندل و اندیکاتورها" onPointerMove={onMove} onPointerLeave={() => setHov(-1)} />
              {hi >= 0 && (<div className="tip">{fd(h[hi].t)}<br />باز {fa(h[hi].o)} · بالا {fa(h[hi].h)}<br />پایین {fa(h[hi].l)} · بسته {fa(h[hi].c)}<br />RSI {fa(A.rs[hi], 0)} · MACD {A.mh[hi] > 0 ? "+" : "−"} · %K {fa(A.K[hi], 0)}</div>)}
            </div>
          </section>
        )}
        <section className="two eq">
          <div className="card"><h2>اندیکاتورها</h2>
            {sig && (<table><tbody>
              {sig.rows.map((x) => (<tr key={x.n}><td>{x.n}</td><td>{x.v}</td><td>{x.s > 0.25 ? <span className="up">خرید</span> : x.s < -0.25 ? <span className="dn">فروش</span> : <span className="mu">خنثی</span>}</td></tr>))}
              <tr><td>نوسان روزانه (ATR)</td><td colSpan={2}>{fa((A.atr[n - 1] / P) * 100, 1)}٪</td></tr>
            </tbody></table>)}
          </div>
          <div className="card"><h2>منابع قیمت</h2>
            <table><tbody>
              {S.res.map((r, i) => (<tr key={r.n + i}><td>{r.n}</td><td>{r.ok ? fa(r.p) : <span className="mu">{r.err}</span>}</td><td>{r.ok ? <span className={cls(r.p / P - 1)}>{pct((r.p / P - 1) * 100)}</span> : <span className="dn">✕</span>}</td></tr>))}
            </tbody></table>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="gd">
      <style>{CSS}</style>
      <header><div className="hd">
        <div><h1>تحلیل طلای ۱۸ عیار</h1>
          <div className="mu">{busy ? "در حال دریافت…" : S ? (S.mode === "live" ? "میانه‌ی " + fa(S.nOk) + " منبع زنده" + (S.ai ? " (جست‌وجوی وب)" : "") : S.mode === "cmp" ? "قیمت محاسباتی" : "آخرین نرخ ثبت‌شده") + " · " + S.t.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) : ""}</div></div>
        <div><button onClick={load} disabled={busy}>به‌روزرسانی</button> <button onClick={() => setShowCfg((v) => !v)}>تنظیمات</button></div>
      </div>
        {showCfg && (<div className="hd"><div style={{ width: "100%" }}><div className="mu">پروکسی اختصاصی (اختیاری؛ آدرس سایت بعد از آن اضافه می‌شود)</div><input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="https://your-worker.workers.dev/?url=" /></div></div>)}
      </header>
      {body}
      <footer>ابزار تحلیلی است، نه توصیه‌ی مالی. نمودار از اونس جهانی (PAXG) × دلار تتر ساخته و با قیمت بازار هم‌مقیاس می‌شود؛ پس تقریبی است.</footer>
    </div>
  );
}
