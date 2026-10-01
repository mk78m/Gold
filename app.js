(() => {
  "use strict";

  const API = "https://xaus.com/api/v1";
  const state = {
    candles: [],
    visible: 80,
    range: "1y",
    interval: "1d",
    loading: false
  };

  const $ = (id) => document.getElementById(id);

  function fmt(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function timestampMs(value) {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
    if (/^\\d+(?:\\.\\d+)?$/.test(String(value).trim())) {
      const n = Number(value);
      return n < 1e12 ? n * 1000 : n;
    }
    return new Date(value).getTime();
  }

  function dateText(value) {
    const ms = timestampMs(value);
    return Number.isFinite(ms) ? new Date(ms).toLocaleString("fa-IR") : String(value ?? "—");
  }

  function setStatus(text, kind = "") {
    $("status").textContent = text;
    $("statusBox").className = "status " + kind;
  }

  function ema(a, p) {
    if (!a.length) return [];
    const k = 2 / (p + 1);
    const out = [a[0]];
    for (let i = 1; i < a.length; i++) out.push(a[i] * k + out[i - 1] * (1 - k));
    return out;
  }

  function sma(a, p) {
    const out = Array(a.length).fill(null);
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i];
      if (i >= p) sum -= a[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  function rsi(a, p = 14) {
    const out = Array(a.length).fill(null);
    if (a.length <= p) return out;

    let gain = 0, loss = 0;
    for (let i = 1; i <= p; i++) {
      const d = a[i] - a[i - 1];
      gain += Math.max(d, 0);
      loss += Math.max(-d, 0);
    }
    gain /= p; loss /= p;
    out[p] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);

    for (let i = p + 1; i < a.length; i++) {
      const d = a[i] - a[i - 1];
      gain = (gain * (p - 1) + Math.max(d, 0)) / p;
      loss = (loss * (p - 1) + Math.max(-d, 0)) / p;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function rma(values, p) {
    const out = Array(values.length).fill(null);
    if (values.length < p) return out;
    let prev = values.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out[p - 1] = prev;
    for (let i = p; i < values.length; i++) {
      prev = ((prev * (p - 1)) + values[i]) / p;
      out[i] = prev;
    }
    return out;
  }

  function trueRanges(c) {
    return c.map((x, i) => i === 0
      ? x.h - x.l
      : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))
    );
  }

  function atr(c, p = 14) {
    return rma(trueRanges(c), p);
  }

  function bollinger(a, p = 20, mult = 2) {
    const mid = sma(a, p), up = Array(a.length).fill(null), lo = Array(a.length).fill(null);
    for (let i = p - 1; i < a.length; i++) {
      const m = mid[i], s = a.slice(i - p + 1, i + 1);
      const sd = Math.sqrt(s.reduce((z, v) => z + (v - m) ** 2, 0) / p);
      up[i] = m + mult * sd;
      lo[i] = m - mult * sd;
    }
    return { mid, up, lo };
  }

  function stochastic(c, p = 14) {
    const out = Array(c.length).fill(null);
    for (let i = p - 1; i < c.length; i++) {
      const s = c.slice(i - p + 1, i + 1);
      const hi = Math.max(...s.map(x => x.h));
      const lo = Math.min(...s.map(x => x.l));
      out[i] = hi === lo ? 50 : 100 * (c[i].c - lo) / (hi - lo);
    }
    return out;
  }

  function adx(c, p = 14) {
    const out = Array(c.length).fill(null);
    if (c.length < (2 * p)) return out;

    const tr = [], plusDM = [], minusDM = [];
    for (let i = 1; i < c.length; i++) {
      const x = c[i], q = c[i - 1];
      tr.push(Math.max(x.h - x.l, Math.abs(x.h - q.c), Math.abs(x.l - q.c)));
      const up = x.h - q.h, down = q.l - x.l;
      plusDM.push(up > down && up > 0 ? up : 0);
      minusDM.push(down > up && down > 0 ? down : 0);
    }

    let smTR = tr.slice(0, p).reduce((a, b) => a + b, 0);
    let smPlus = plusDM.slice(0, p).reduce((a, b) => a + b, 0);
    let smMinus = minusDM.slice(0, p).reduce((a, b) => a + b, 0);
    const dx = [];

    const makeDX = () => {
      const plusDI = smTR ? 100 * smPlus / smTR : 0;
      const minusDI = smTR ? 100 * smMinus / smTR : 0;
      return (plusDI + minusDI) ? 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI) : 0;
    };

    dx.push(makeDX());
    for (let i = p; i < tr.length; i++) {
      smTR = smTR - (smTR / p) + tr[i];
      smPlus = smPlus - (smPlus / p) + plusDM[i];
      smMinus = smMinus - (smMinus / p) + minusDM[i];
      dx.push(makeDX());
    }

    if (dx.length < p) return out;
    let adxValue = dx.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out[2 * p - 1] = adxValue;
    for (let j = p; j < dx.length; j++) {
      adxValue = ((adxValue * (p - 1)) + dx[j]) / p;
      out[p + j] = adxValue;
    }
    return out;
  }

  function cci(c, p = 20) {
    const tp = c.map(x => (x.h + x.l + x.c) / 3);
    const out = Array(c.length).fill(null);
    for (let i = p - 1; i < c.length; i++) {
      const s = tp.slice(i - p + 1, i + 1);
      const m = s.reduce((a, b) => a + b, 0) / p;
      const dev = s.reduce((a, b) => a + Math.abs(b - m), 0) / p;
      out[i] = dev ? (tp[i] - m) / (0.015 * dev) : 0;
    }
    return out;
  }

  function williamsR(c, p = 14) {
    const out = Array(c.length).fill(null);
    for (let i = p - 1; i < c.length; i++) {
      const s = c.slice(i - p + 1, i + 1);
      const hi = Math.max(...s.map(x => x.h)), lo = Math.min(...s.map(x => x.l));
      out[i] = hi === lo ? -50 : -100 * (hi - c[i].c) / (hi - lo);
    }
    return out;
  }

  function obv(c) {
    if (c.length < 2 || !c.every(x => Number.isFinite(Number(x.v)))) return null;
    let value = 0;
    for (let i = 1; i < c.length; i++) {
      const volume = Number(c[i].v);
      if (c[i].c > c[i - 1].c) value += volume;
      else if (c[i].c < c[i - 1].c) value -= volume;
    }
    return value;
  }

  function macd(a) {
    const e12 = ema(a, 12), e26 = ema(a, 26);
    const line = e12.map((v, i) => v - e26[i]);
    const signal = ema(line, 9);
    return { line, signal, hist: line.map((v, i) => v - signal[i]) };
  }

  function technical(c) {
    const a = c.map(x => x.c);
    const i = a.length - 1;
    const e20 = ema(a, 20), e50 = ema(a, 50), e200 = ema(a, 200);
    const sm20 = sma(a, 20), r = rsi(a), m = macd(a);
    const bb = bollinger(a), at = atr(c), st = stochastic(c), ad = adx(c);
    const cc = cci(c), w = williamsR(c), volumeObv = obv(c);

    let score = 0;
    const add = (condition) => { if (condition) score += 1; };

    add(a[i] > e20[i]);
    add(a[i] > e50[i]);
    if (a.length >= 200) add(a[i] > e200[i]);
    add(m.hist[i] > 0);
    if (r[i] != null) add(r[i] > 50 && r[i] < 70);
    if (st[i] != null) add(st[i] > 50 && st[i] < 80);
    if (ad[i] != null) add(ad[i] > 20);
    if (cc[i] != null) add(cc[i] > 0);
    if (w[i] != null) add(w[i] > -50);

    const maxScore = a.length >= 200 ? 9 : 8;
    const pct = Math.round((score / maxScore) * 100);
    const sig = pct >= 67 ? "BUY" : pct <= 33 ? "SELL" : "WAIT";

    return {
      e20: e20[i], e50: e50[i], e200: a.length >= 200 ? e200[i] : null,
      r: r[i], macd: m.line[i], atr: at[i], st: st[i], adx: ad[i],
      sma20: sm20[i], cci: cc[i], will: w[i], obv: volumeObv,
      bb: bb.mid[i] == null ? null : (a[i] - bb.mid[i]) / ((bb.up[i] - bb.lo[i]) || 1),
      sig, score: pct
    };
  }

  function validateDataState(payload, label) {
    const ds = payload?.data_state;
    if (ds?.status === "unavailable") throw new Error(`${label}: داده در منبع موجود نیست`);
    return ds || {};
  }

  function extractCandles(payload) {
    const raw = payload?.data || payload?.points || payload?.candles || payload?.ohlcv || [];
    if (!Array.isArray(raw)) throw new Error("ساختار دادهٔ OHLCV معتبر نیست");
    const candles = raw.map(x => {
      if (Array.isArray(x)) return { t:x[0], o:+x[1], h:+x[2], l:+x[3], c:+x[4], v:x[5] };
      return {
        t:x.t ?? x.time ?? x.ts ?? x.d ?? x.date,
        o:+(x.o ?? x.open), h:+(x.h ?? x.high),
        l:+(x.l ?? x.low), c:+(x.c ?? x.close), v:x.v ?? x.volume
      };
    }).filter(x =>
      x.t != null && Number.isFinite(x.o) && Number.isFinite(x.h) &&
      Number.isFinite(x.l) && Number.isFinite(x.c)
    ).sort((a,b) => timestampMs(a.t) - timestampMs(b.t));

    if (!candles.length) return [];
    for (let i = 0; i < candles.length; i++) {
      const x = candles[i], ts = timestampMs(x.t);
      if (!Number.isFinite(ts)) throw new Error("timestamp کندل معتبر نیست");
      if (!(x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && x.h >= x.l)) {
        throw new Error(`OHLC نامعتبر در کندل ${dateText(x.t)}`);
      }
      if (i > 0 && timestampMs(candles[i - 1].t) >= ts) {
        throw new Error("کندل‌ها timestamp یکتا و صعودی ندارند");
      }
    }
    return candles;
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache:"no-store", headers:{Accept:"application/json"} });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    $("loading").classList.remove("error");
    $("loading").textContent = "در حال دریافت داده…";
    $("loading").style.display = "grid";
    setStatus("در حال دریافت داده واقعی…", "warn");

    try {
      const fresh = Date.now();
      const chartURL = `${API}/chart?symbol=xau&range=${encodeURIComponent(state.range)}&interval=${encodeURIComponent(state.interval)}&fresh=${fresh}`;
      const spotURL = `${API}/spot?compact=1&fresh=${fresh}`;

      const [chartResult, spotResult] = await Promise.allSettled([
        fetchJSON(chartURL),
        fetchJSON(spotURL)
      ]);

      if (chartResult.status === "rejected") {
        throw new Error(`دریافت نمودار: ${chartResult.reason?.message || "خطای نامشخص"}`);
      }

      const chart = chartResult.value;
      const spot = spotResult.status === "fulfilled" ? spotResult.value : null;
      const chartState = validateDataState(chart, "نمودار");
      const spotState = spot ? validateDataState(spot, "Spot") : {};
      const candles = extractCandles(chart);
      if (!candles.length) throw new Error("پاسخ API شامل OHLC معتبر نبود");
      if (candles.length < 30) throw new Error(`تعداد کندل کافی نیست: ${candles.length}`);

      state.candles = candles;

      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const change = prev ? ((last.c - prev.c) / prev.c) * 100 : null;

      const spotPrice = Number(spot?.spot_usd_oz);
      $("price").textContent = Number.isFinite(spotPrice) ? fmt(spotPrice) : fmt(last.c);
      $("ohlc").textContent = `${fmt(last.o)} / ${fmt(last.h)} / ${fmt(last.l)} / ${fmt(last.c)}`;
      $("chg").textContent = change == null ? "—" : `${fmt(last.c - prev.c)} (${fmt(change)}%)`;
      $("chg").className = change > 0 ? "up" : change < 0 ? "down" : "";
      $("hl").textContent = `${fmt(last.h)} / ${fmt(last.l)}`;

      const timestamp = spot?.price_as_of || spot?.data_state?.as_of ||
        spot?.updated_at || chart?.data_state?.as_of || chart?.updated_at || last.t;
      $("updated").textContent = dateText(timestamp);

      const t = technical(candles);
      const vals = {
        ema20:t.e20, ema50:t.e50, ema200:t.e200, rsi:t.r, macd:t.macd,
        atr:t.atr, stoch:t.st, adx:t.adx, sma20:t.sma20, cci:t.cci, will:t.will, obv:t.obv
      };
      Object.entries(vals).forEach(([id, value]) => $(id).textContent = id === "obv" ? (value == null ? "N/A" : fmt(value, 0)) : fmt(value));
      $("bb").textContent = t.bb == null ? "—" : `${fmt(t.bb * 100, 1)}%`;

      $("sig").textContent = t.sig;
      $("sig").className = t.sig === "BUY" ? "up" : t.sig === "SELL" ? "down" : "";
      $("score").textContent = `${t.score}%`;
      $("meter").style.width = `${t.score}%`;

      const ds = chartState;
      const statusText = ds.status ? `${ds.status} · ${candles.length} OHLCV` : `متصل · ${candles.length} OHLCV`;
      const statusKind = ds.status === "stale" || spotState.status === "stale" ? "warn" : "";
      setStatus(`XAUS · ${statusText}`, statusKind);

      $("sourceInfo").textContent =
        `منبع نمودار: XAUS API / Yahoo Finance proxy\n` +
        `وضعیت نمودار: ${ds.status || "نامشخص"}${ds.age_seconds != null ? ` · سن: ${fmt(ds.age_seconds,0)} ثانیه` : ""}\n` +
        `وضعیت Spot: ${spotState.status || (spotResult.status === "rejected" ? "unavailable" : "نامشخص")}\n` +
        `بازه نمودار: ${state.range} / ${state.interval}` +
        (spotResult.status === "rejected" ? `\nSpot جداگانه در دسترس نبود؛ قیمت از آخرین close نمودار استفاده شد.` : "");

      $("chartNote").textContent =
        `XAUS · ${state.range} / ${state.interval} · ${candles.length} کندل OHLCV واقعی · آخرین کندل: ${dateText(last.t)}`;

      if (spotResult.status === "rejected") {
        setStatus("XAUS · نمودار متصل، Spot ناموفق", "warn");
      }

      $("loading").style.display = "none";
      draw();
    } catch (err) {
      $("loading").classList.add("error");
      $("loading").textContent = `دریافت داده ناموفق بود: ${err.message}`;
      setStatus("خطا در دریافت داده", "error");
      $("chartNote").textContent = "نمودار به‌دلیل نبود OHLC معتبر به‌صورت ساختگی پر نمی‌شود. اتصال اینترنت و API را بررسی کنید.";
    } finally {
      state.loading = false;
    }
  }

  function draw() {
    const canvas = $("chart");
    const ctx = canvas.getContext("2d");
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const visible = state.interval === "2m" ? 180 : state.interval === "15m" ? 120 : state.interval === "1h" ? 120 : 120;
    const c = state.candles.slice(-visible);
    if (!c.length) return;

    const minRaw = Math.min(...c.map(x => x.l));
    const maxRaw = Math.max(...c.map(x => x.h));
    const pad = (maxRaw - minRaw) * 0.08 || Math.max(maxRaw * 0.001, 1);
    const min = minRaw - pad, max = maxRaw + pad;

    const left = 58, right = 14, top = 24, bottom = 28;
    const plotW = Math.max(1, w - left - right);
    const plotH = Math.max(1, h - top - bottom);
    const step = plotW / c.length;
    const candleW = Math.max(1, step * 0.68);
    const y = v => top + ((max - v) / (max - min)) * plotH;

    ctx.font = "10px Tahoma";
    ctx.textAlign = "left";

    for (let j = 0; j <= 5; j++) {
      const yy = top + j * plotH / 5;
      ctx.strokeStyle = "#151d27";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(w - right, yy); ctx.stroke();
      ctx.fillStyle = "#7f8b9b";
      ctx.fillText(fmt(max - (max - min) * j / 5, 0), 5, yy + 3);
    }

    c.forEach((x, i) => {
      const xx = left + (i + 0.5) * step;
      const yo = y(x.o), yc = y(x.c), yh = y(x.h), yl = y(x.l);
      const up = x.c >= x.o;

      ctx.strokeStyle = up ? "#35d58a" : "#ff5c6c";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xx, yh); ctx.lineTo(xx, yl); ctx.stroke();

      const bh = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(xx - candleW / 2, Math.min(yo, yc), candleW, bh);
    });

    const last = c[c.length - 1];
    ctx.strokeStyle = "#d8ad52";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(left, y(last.c)); ctx.lineTo(w - right, y(last.c)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#f0d487";
    ctx.textAlign = "right";
    ctx.fillText(fmt(last.c), w - right, Math.max(top + 10, y(last.c) - 5));
  }

  document.querySelectorAll(".btn[data-range]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn[data-range]").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      state.range = btn.dataset.range;
      state.interval = btn.dataset.interval;
      load();
    });
  });

  $("reload").addEventListener("click", load);
  window.addEventListener("resize", draw);
  load();
  setInterval(load, 30000);
})();
