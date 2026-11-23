// Markkinakatsauksen datapäivitys.
// Hakee kaiken sivulla näkyvän datan oikeista lähteistä ja kirjoittaa sen tiedostoon data.js.
// index.html lukee datan sieltä, joten HTML:ää ei enää muokata regexeillä.
//
// Lähteet:
//   Yahoo Finance  – pörssit, hyödykkeet, VIX, US 10Y (viikko- ja kuukausidata)
//   FRED           – Philadelphia Fedin teollisuusindeksi (vaatii FRED_API_KEY-ympäristömuuttujan)
//   OECD           – G20:n ennakoiva suhdanneindikaattori (CLI)
//   Drewry         – World Container Index (viikoittain, historia tallennetaan wci_history.json:iin)
//
// Jos jokin lähde ei vastaa, sen edellinen data säilyy data.js:ssä. Ajo: node update_data.mjs

import fs from 'node:fs';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const KK = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
const WEEKS = 52;
const MONTHS = 120;

const SYMBOLS = {
  omxh: '^OMXH25',
  sp500: '^GSPC',
  stoxx: '^STOXX',
  wti: 'CL=F',
  brent: 'BZ=F',
  gold: 'GC=F',
  copper: 'HG=F',
  vix: '^VIX',
  tnx: '^TNX',
};

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const iso = d => d.toISOString().slice(0, 10);
const monthKey = d => d.toISOString().slice(0, 7);
const monthLabel = key => `${KK[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

// Viikon maanantai (UTC-päivämäärä) annetulle päivälle
function mondayOf(d) {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
  return m;
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000), ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Yahoo: palauttaa [{date (pörssin paikallinen päivä), close}] ja viimeisimmän hinnan
async function yahoo(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = (await fetchJson(url)).chart.result[0];
  // gmtoffset on pörssin nykyinen aikaero; kesäajan takia se voi heittää tunnin, joten lisätään
  // 3 h pelivaraa, ettei kuun/viikon ensimmäisen päivän keskiyö valu edelliselle päivälle.
  const off = ((res.meta.gmtoffset || 0) + 3 * 3600) * 1000;
  const closes = res.indicators.quote[0].close;
  const points = res.timestamp
    .map((t, i) => ({ date: new Date(t * 1000 + off), close: closes[i] }))
    .filter(p => p.close != null && Number.isFinite(p.close));
  return { points, price: res.meta.regularMarketPrice };
}

// ── Aikajanat ───────────────────────────────────────────────
const now = new Date();
const thisMonday = mondayOf(now);
const weekGrid = Array.from({ length: WEEKS }, (_, i) => {
  const d = new Date(thisMonday);
  d.setUTCDate(d.getUTCDate() - (WEEKS - 1 - i) * 7);
  return iso(d);
});
const monthGrid = Array.from({ length: MONTHS }, (_, i) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1 - i), 1));
  return monthKey(d);
});

// ── Edellinen data (varalle, jos lähde ei vastaa) ───────────
let old = {};
try {
  const txt = fs.readFileSync('data.js', 'utf8');
  old = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
} catch { /* ensimmäinen ajo */ }

const out = {
  updated: now.toISOString(),
  weekly: { labels: weekGrid.map(d => `${d.slice(8, 10)}.${d.slice(5, 7)}`) },
  cards: {},
  hist: { labels: monthGrid.map(monthLabel) },
  macro: {},
  wci: null,
};
const failed = [];

// ── Yahoo Finance ───────────────────────────────────────────
for (const [key, sym] of Object.entries(SYMBOLS)) {
  try {
    const wk = await yahoo(sym, '1y', '1wk');
    const byWeek = {};
    for (const p of wk.points) byWeek[iso(mondayOf(p.date))] = p.close;
    let last = null;
    const series = weekGrid.map(w => (last = byWeek[w] ?? last)); // täytä aukot edellisellä arvolla
    if (series.filter(v => v != null).length < 10) throw new Error('liian vähän viikkodataa');
    const dec = key === 'copper' ? 3 : 2;
    out.weekly[key] = series.map(v => round(v, dec));

    const latest = wk.price ?? series.at(-1);
    const prevWeek = series.at(-2);
    out.cards[key] = {
      value: round(latest, dec),
      changePct: prevWeek ? round((latest / prevWeek - 1) * 100, 2) : null,
    };

    const mo = await yahoo(sym, '10y', '1mo');
    const byMonth = {};
    for (const p of mo.points) byMonth[monthKey(p.date)] = p.close;
    out.hist[key] = monthGrid.map(m => round(byMonth[m] ?? null, dec));
    console.log(`OK  ${key.padEnd(7)} ${sym.padEnd(8)} ${latest}`);
  } catch (e) {
    failed.push(key);
    console.log(`VIRHE ${key} (${sym}): ${e.message} – käytetään edellistä dataa`);
    if (old.weekly?.[key]) out.weekly[key] = old.weekly[key];
    if (old.cards?.[key]) out.cards[key] = old.cards[key];
    if (old.hist?.[key]) out.hist[key] = old.hist[key];
  }
}

// ── Kuukausisarjat makrolle ─────────────────────────────────
function monthlySeries(obs, label) {
  // obs: [{month:'YYYY-MM', value}], vanhimmasta uusimpaan
  const last = obs.slice(-13);
  const byMonth = Object.fromEntries(obs.map(o => [o.month, o.value]));
  return {
    card: {
      label,
      latest: last.at(-1).value,
      prev: last.at(-2).value,
      period: monthLabel(last.at(-1).month),
      dates: last.map(o => monthLabel(o.month)),
      values: last.map(o => o.value),
    },
    hist: monthGrid.map(m => byMonth[m] ?? null),
  };
}

// FRED: Philadelphia Fed Manufacturing Business Outlook (diffuusioindeksi, 0 = raja)
try {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY puuttuu');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=GACDFSA066MSFRBPHI&api_key=${key}&file_type=json&sort_order=desc&limit=${MONTHS + 1}`;
  const d = await fetchJson(url);
  const obs = d.observations
    .filter(o => o.value !== '.')
    .reverse()
    .map(o => ({ month: o.date.slice(0, 7), value: round(Number(o.value), 1) }));
  const s = monthlySeries(obs, 'Philly Fed');
  out.macro.philly = s.card;
  out.hist.philly = s.hist;
  console.log(`OK  philly  ${s.card.latest} (${s.card.period})`);
} catch (e) {
  failed.push('philly');
  console.log(`VIRHE Philly Fed: ${e.message} – käytetään edellistä dataa`);
  if (old.macro?.philly) out.macro.philly = old.macro.philly;
  if (old.hist?.philly) out.hist.philly = old.hist.philly;
}

// OECD: G20 Composite Leading Indicator (100 = pitkän aikavälin trendi)
try {
  const start = monthGrid[0];
  const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,/G20.M.LI...AA...H?startPeriod=${start}&format=csv`;
  // OECD:n rajapinta antaa välillä tilapäisen HTTP 500/429 -virheen, joten yritetään muutaman kerran
  let r;
  for (let i = 1; i <= 4; i++) {
    r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) }).catch(e => ({ ok: false, status: e.message }));
    if (r.ok) break;
    console.log(`  OECD yritys ${i}: HTTP ${r.status}`);
    await new Promise(res => setTimeout(res, 15000 * i));
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const [head, ...rows] = (await r.text()).trim().split(/\r?\n/).map(l => l.split(','));
  const iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
  const obs = rows
    .map(c => ({ month: c[iT], value: round(Number(c[iV]), 2) }))
    .filter(o => /^\d{4}-\d{2}$/.test(o.month) && o.value != null)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (obs.length < 13) throw new Error('liian vähän dataa');
  const s = monthlySeries(obs, 'OECD CLI G20');
  out.macro.cli = s.card;
  out.hist.cli = s.hist;
  console.log(`OK  cli      ${s.card.latest} (${s.card.period})`);
} catch (e) {
  failed.push('cli');
  console.log(`VIRHE OECD CLI: ${e.message} – käytetään edellistä dataa`);
  if (old.macro?.cli) out.macro.cli = old.macro.cli;
  if (old.hist?.cli) out.hist.cli = old.hist.cli;
}

// ── Drewry WCI ──────────────────────────────────────────────
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
let wciHist = [];
try { wciHist = JSON.parse(fs.readFileSync('wci_history.json', 'utf8')); } catch { /* tyhjä */ }
try {
  const r = await fetch('https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry',
    { headers: UA, signal: AbortSignal.timeout(30000) });
  const html = await r.text();
  const m = html.match(/(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (20\d\d)[^$]{0,200}?\$\s*([\d,]+)\s*per 40/);
  if (!m) throw new Error('hintaa ei löytynyt sivulta');
  const date = `${m[3]}-${String(MON[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const value = Number(m[4].replace(/,/g, ''));
  if (value < 500 || value > 20000) throw new Error(`epäuskottava arvo ${value}`);
  if (!wciHist.some(p => p.date === date)) wciHist.push({ date, value });
  wciHist.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync('wci_history.json', JSON.stringify(wciHist, null, 1) + '\n');
  console.log(`OK  wci      ${value} (${date})`);
} catch (e) {
  failed.push('wci');
  console.log(`VIRHE WCI: ${e.message} – käytetään tallennettua historiaa`);
}
if (wciHist.length) {
  const h = wciHist.slice(-WEEKS);
  const latest = h.at(-1), prev = h.at(-2);
  out.wci = {
    labels: h.map(p => `${p.date.slice(8, 10)}.${p.date.slice(5, 7)}`),
    values: h.map(p => p.value),
    latest: latest.value,
    date: latest.date,
    changePct: prev ? round((latest.value / prev.value - 1) * 100, 1) : null,
  };
}

// ── Tallennus ───────────────────────────────────────────────
const total = Object.keys(SYMBOLS).length + 3;
if (failed.length >= total) {
  console.error('Kaikki lähteet epäonnistuivat – data.js:ää ei muutettu.');
  process.exit(1);
}
fs.writeFileSync('data.js',
  '// Generoitu tiedosto (update_data.mjs) – älä muokkaa käsin.\n' +
  `window.MK_DATA = ${JSON.stringify(out)};\n`);
console.log(failed.length ? `Valmis, mutta epäonnistui: ${failed.join(', ')}` : 'Kaikki valmis!');
