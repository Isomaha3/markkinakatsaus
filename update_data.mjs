// Markkinakatsauksen datapäivitys.
// Hakee kaiken sivulla näkyvän datan oikeista lähteistä ja kirjoittaa sen tiedostoon data.js.
// index.html lukee datan sieltä, joten HTML:ää ei enää muokata regexeillä.
//
// Lähteet:
//   Yahoo Finance  – pörssit, hyödykkeet, VIX, US 10Y (viikko- ja kuukausidata)
//   ISM / PR Newswire – USA:n teollisuuden ostopäällikköindeksi (historia ism_history.json:ssa)
//   S&P Global     – euroalueen ja USA:n teollisuus-PMI tiedotteiden PDF:istä (historia spg_pmi_history.json:ssa)
//   OECD           – G20:n ennakoiva suhdanneindikaattori (CLI)
//   Drewry         – World Container Index (viikoittain, historia tallennetaan wci_history.json:iin)
//
// Jos jokin lähde ei vastaa, sen edellinen data säilyy data.js:ssä. Ajo: node update_data.mjs

import fs from 'node:fs';
import zlib from 'node:zlib';
import { usMonthlyAverage } from './yields.mjs';
import { finishWeekly } from './weekly.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const KK = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
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
  btc: 'BTC-USD',
};

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const iso = d => d.toISOString().slice(0, 10);
const monthKey = d => d.toISOString().slice(0, 7);
const monthLabel = key => `${KK[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

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
const monthGrid = Array.from({ length: MONTHS }, (_, i) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1 - i), 1));
  return monthKey(d);
});
const pctCh = (a, b) => (a != null && b ? round((a / b - 1) * 100, 2) : null);

// ── Edellinen data (varalle, jos lähde ei vastaa) ───────────
let old = {};
try {
  const txt = fs.readFileSync('data.js', 'utf8');
  old = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
} catch { /* ensimmäinen ajo */ }

// Sarjat ovat muotoa { d: ['YYYY-MM-DD', ...], v: [arvo, ...] } – kuvaajat piirtävät pisteet oikeille päiville.
const out = {
  updated: now.toISOString(),
  cards: {},
  daily: {},   // 1 v päivän päätöskurssit (12 kk -kuvaajat)
  hist: {},    // 10 v viikon päätöskurssit ja makron kuukausisarjat (10 v -kuvaajat)
  macro: {},
  wci: null,
};
const failed = [];
// Lähdekohtainen tuoreus: aikaleima päivittyy VAIN kun lähteen haku onnistuu. Jos käytetään vanhaa
// dataa varalla, edellinen aikaleima säilyy, jolloin sivu voi varoittaa vanhentuneesta luvusta.
const fresh = { ...(old.fresh || {}) };
const ok = k => { fresh[k] = now.toISOString(); };
const notOk = k => { if (!(k in fresh)) fresh[k] = null; };   // ei koskaan onnistunut tiedossa olevasti

// Pisteet → {d, v}; saman päivän useasta pisteestä jää viimeinen
function toSeries(points, dec, dateOf = p => iso(p.date)) {
  const m = new Map();
  for (const p of points) m.set(dateOf(p), round(p.close, dec));
  return { d: [...m.keys()], v: [...m.values()] };
}

// ── Yahoo Finance ───────────────────────────────────────────
for (const [key, sym] of Object.entries(SYMBOLS)) {
  try {
    const dec = key === 'copper' ? 3 : 2;
    const dy = await yahoo(sym, '1y', '1d');
    const daily = toSeries(dy.points, dec);
    if (daily.v.length < 50) throw new Error('liian vähän päivädataa');
    const latest = dy.price ?? daily.v.at(-1);
    daily.v[daily.v.length - 1] = round(latest, dec); // viimeisin piste = sama luku kuin kortissa
    out.daily[key] = daily;
    // Viikkomuutos päivämäärän mukaan (viimeisin päätöskurssi vähintään 7 pv sitten), jotta se on
    // oikein myös Bitcoinille, jolla kauppaa käydään viikonloppuisin.
    const wkAgo = new Date(daily.d.at(-1) + 'T12:00:00Z'); wkAgo.setUTCDate(wkAgo.getUTCDate() - 7);
    const wkIdx = daily.d.findLastIndex(d => d <= iso(wkAgo));
    out.cards[key] = {
      value: round(latest, dec),
      date: daily.d.at(-1),
      dayPct: pctCh(latest, daily.v.at(-2)),
      weekPct: wkIdx >= 0 ? pctCh(latest, daily.v[wkIdx]) : null,
    };

    // 10 v viikkodata. Yahoo merkitsee viikon alkupäivälle, mutta arvo on viikon viimeinen
    // päätöskurssi, joten siirretään piste viikon perjantaille (viimeinen piste = tämä päivä).
    const wk = await yahoo(sym, '10y', '1wk');
    const weekly = toSeries(wk.points, dec, p => {
      const f = new Date(p.date); f.setUTCDate(f.getUTCDate() + 4); return iso(f);
    });
    // Kesken olevan viikon pisteet (myös tulevalle perjantaille osuva) korvataan tämän päivän luvulla
    out.hist[key] = finishWeekly(weekly, daily.d.at(-1), round(latest, dec));
    console.log(`OK  ${key.padEnd(7)} ${sym.padEnd(8)} ${latest}`);
    ok(key);
  } catch (e) {
    failed.push(key); notOk(key);
    console.log(`VIRHE ${key} (${sym}): ${e.message} – käytetään edellistä dataa`);
    if (old.daily?.[key]) out.daily[key] = old.daily[key];
    if (old.cards?.[key]) out.cards[key] = old.cards[key];
    if (old.hist?.[key]?.d) out.hist[key] = old.hist[key];
  }
}

// ── 10 v valtionlainojen korot: Saksa, Suomi, Ranska (+ USA vertailuun) ──
// EKP: lähentymiskriteerin 10 v korko, kuukausikeskiarvo (IRS-tietokanta) – sama mittari kaikille maille.
// Saksan keskuspankki: Saksan 10 v korko päivittäin (kortin "tänään"-luku).
out.yields = {};
try {
  const r = await fetch(`https://data-api.ecb.europa.eu/service/data/IRS/M.DE+FI+FR.L.L40.CI.0000.EUR.N.Z?startPeriod=${monthGrid[0]}&format=csvdata`,
    { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const [head, ...rows] = (await r.text()).trim().split(/\r?\n/).map(l => l.split(','));
  const iA = head.indexOf('REF_AREA'), iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
  for (const c of ['DE', 'FI', 'FR']) {
    const obs = rows.filter(x => x[iA] === c && x[iV] !== '').map(x => ({ d: `${x[iT]}-01`, v: round(Number(x[iV]), 2) }))
      .sort((a, b) => a.d.localeCompare(b.d));
    if (obs.length < 2) throw new Error(`${c}: liian vähän dataa`);
    out.yields[c.toLowerCase()] = { d: obs.map(o => o.d), v: obs.map(o => o.v) };
  }
  console.log(`OK  korot   DE ${out.yields.de.v.at(-1)}, FI ${out.yields.fi.v.at(-1)}, FR ${out.yields.fr.v.at(-1)} (${out.yields.de.d.at(-1).slice(0, 7)})`);
  ok('korot');
} catch (e) {
  failed.push('korot'); notOk('korot');
  console.log(`VIRHE EKP korot: ${e.message} – käytetään edellistä dataa`);
  for (const c of ['de', 'fi', 'fr']) if (old.yields?.[c]) out.yields[c] = old.yields[c];
}
// USA:n kuukausikeskiarvo ^TNX-datasta, jotta vertailukuvaaja on samalla mittarilla kuin EKP:n luvut
const usMonthly = usMonthlyAverage(out.daily.tnx, out.hist.tnx, new Date().toISOString().slice(0, 7));
if (usMonthly) out.yields.us = usMonthly;
try {
  const r = await fetch('https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A?lastNObservations=40&format=csv',
    { headers: { ...UA, Accept: 'text/csv' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const pts = (await r.text()).split(/\r?\n/).map(l => l.split(';'))
    .filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c[0]) && /^-?\d+,\d+$/.test(c[1]))
    .map(c => ({ d: c[0], v: Number(c[1].replace(',', '.')) }));
  if (pts.length < 2) throw new Error('liian vähän dataa');
  out.cards.de10 = { value: pts.at(-1).v, prev: pts.at(-2).v, date: pts.at(-1).d };
  console.log(`OK  de10    ${pts.at(-1).v} (${pts.at(-1).d})`);
  ok('de10');
} catch (e) {
  failed.push('de10'); notOk('de10');
  console.log(`VIRHE Bundesbank: ${e.message} – käytetään edellistä dataa`);
  if (old.cards?.de10) out.cards.de10 = old.cards.de10;
}

// ── Kuukausisarjat makrolle ─────────────────────────────────
function monthlySeries(obs, label) {
  // obs: [{month:'YYYY-MM', value}], vanhimmasta uusimpaan
  const h = obs.slice(-MONTHS);
  return {
    card: {
      label,
      latest: obs.at(-1).value,
      prev: obs.at(-2).value,
      period: monthLabel(obs.at(-1).month),
    },
    hist: { d: h.map(o => `${o.month}-01`), v: h.map(o => o.value) },
  };
}

// ISM Manufacturing PMI (USA:n teollisuuden ostopäällikköindeksi, 50 = raja).
// ISM:n omat raportit vaativat kirjautumisen, mutta pääluku julkaistaan tiedotteen otsikossa
// PR Newswiressa, esim. "Manufacturing PMI® at 55.5%; October 2026 ISM® Manufacturing PMI® Report".
// Historia on tallessa ism_history.json:ssa, joten joka ajolla riittää lukea uusimmat tiedotteet.
const MONTH_EN = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7,
  August: 8, September: 9, October: 10, November: 11, December: 12 };
let ismHist = [];
try { ismHist = JSON.parse(fs.readFileSync('ism_history.json', 'utf8')); } catch { /* tyhjä */ }
try {
  // 1) PR Newswiren ISM-sivu. Se estää osan palvelinosoitteista (esim. GitHub Actions, HTTP 403),
  // 2) joten varalla Google Newsin RSS-haku, jossa samat tiedotteet näkyvät otsikolla
  //    "... - PR Newswire". Varalähteestä hyväksytään vain PR Newswiren otsikot.
  let titles = [];
  try {
    const r = await fetch('https://www.prnewswire.com/news/institute-for-supply-management/?page=1&pagesize=50',
      { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    titles = [...(await r.text()).matchAll(/title="([^"]*)"/g)].map(m => m[1]);
  } catch (e) { console.log(`  ISM: PR Newswire ${e.message}, kokeillaan Google Newsia`); }
  if (!titles.some(t => /Manufacturing PMI/.test(t))) {
    const r = await fetch('https://news.google.com/rss/search?q=%22Manufacturing+PMI%22+ISM+Report+On+Business&hl=en-US&gl=US&ceid=US:en',
      { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Google News HTTP ${r.status}`);
    titles = [...(await r.text()).matchAll(/<title>([^<]*)<\/title>/g)].map(m => m[1].replace(/&amp;/g, '&'))
      .filter(t => / - PR Newswire$/.test(t)).map(t => t.replace(/ - PR Newswire$/, ''));
  }
  let found = 0, added = 0;
  for (const title of titles) {
    if (!/Manufacturing/.test(title) || /Non-Manufacturing|Services|Hospital|Semiannual|Forecast/i.test(title)) continue;
    const v = title.match(/PMI®? (?:at|registers|registered) ([\d.]+)%/);
    const m = title.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/);
    if (!v || !m) continue;
    const value = Number(v[1]);
    if (value < 25 || value > 75) continue; // epäuskottava
    found++;
    const month = `${m[2]}-${String(MONTH_EN[m[1]]).padStart(2, '0')}`;
    const existing = ismHist.find(p => p.month === month);
    if (!existing) { ismHist.push({ month, value }); added++; }
    else if (existing.value !== value) existing.value = value; // mahdollinen korjaus
  }
  if (!found) throw new Error('PMI-tiedotteita ei löytynyt sivulta');
  ismHist.sort((a, b) => a.month.localeCompare(b.month));
  fs.writeFileSync('ism_history.json', JSON.stringify(ismHist, null, 1) + '\n');
  console.log(`OK  ism      ${ismHist.at(-1).value} (${ismHist.at(-1).month}, uusia ${added})`);
  ok('ism');
} catch (e) {
  failed.push('ism'); notOk('ism');
  console.log(`VIRHE ISM PMI: ${e.message} – käytetään tallennettua historiaa`);
}
if (ismHist.length >= 13) {
  const s = monthlySeries(ismHist, 'ISM PMI');
  out.macro.ism = s.card;
  out.hist.ism = s.hist;
}

// S&P Global Manufacturing PMI: euroalue ja USA (sama menetelmä, joten vertailukelpoiset).
// Luvut ovat vain tiedotteiden PDF:issä. Ennakko (flash) julkaistaan kuun lopulla ja lopullinen
// luku seuraavan kuun alussa; lopullinen korvaa ennakon. Flash-tiedotteessa on myös edellisen
// kuun lopullinen luku, esim. "Flash Eurozone Manufacturing PMI: 52.9 (October: 52.7)".
function pdfText(buf) {
  const s = buf.toString('latin1');
  let txt = '';
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const st = m.index + m[0].length, en = s.indexOf('endstream', st);
    let d;
    try { d = zlib.inflateSync(buf.subarray(st, en)).toString('latin1'); } catch { continue; }
    for (const p of d.matchAll(/\[([^\]]*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj|(ET)/g)) {
      if (p[3]) { txt += '\n'; continue; }
      if (p[1] != null) {
        for (const q of p[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+\.?\d*)/g))
          txt += q[1] != null ? q[1] : (Number(q[2]) < -200 ? ' ' : '');
      } else txt += p[2];
    }
  }
  return txt.replace(/\\([()])/g, '$1').replace(/[ \t]+/g, ' ');
}
const SPG_RELEASES = [
  [/^(S&P Global|HCOB) Flash Eurozone PMI$/, 'ez', 'flash', 'Eurozone'],
  [/^(S&P Global|HCOB) Eurozone Manufacturing PMI$/, 'ez', 'final', 'Eurozone'],
  [/^S&P Global Flash US PMI$/, 'us', 'flash', 'US'],
  [/^S&P Global US Manufacturing PMI$/, 'us', 'final', 'US'],
];
const prevMonth = (y, m) => (m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
let spgHist = { ez: [], us: [] };
try { spgHist = JSON.parse(fs.readFileSync('spg_pmi_history.json', 'utf8')); } catch { /* tyhjä */ }
function spgSet(region, month, value, flash) {
  if (!(value >= 25 && value <= 75)) return;
  const arr = spgHist[region];
  const e = arr.find(p => p.month === month);
  if (!e) arr.push({ month, value, flash });
  else if (!flash || e.flash) { e.value = value; e.flash = flash; } // ennakko ei korvaa lopullista
}
try {
  const r = await fetch('https://www.pmi.spglobal.com/Public/Release/PressReleases', { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const h = (await r.text()).replace(/\s+/g, ' ');
  let read = 0;
  for (const m of h.matchAll(/releaseDate">([^<]*)<\/span> <span class="releaseTitle">([^<]*)<\/span> <span class="greenListItem"><a href="[^"]*PressRelease\/([0-9a-f]{32})/g)) {
    const title = m[2].replace(/&amp;/g, '&').trim();
    const rel = SPG_RELEASES.find(([re]) => re.test(title));
    const dm = m[1].replace(/&nbsp;/g, ' ').match(/([A-Z][a-z]+) (\d+) (\d{4})/);
    if (!rel || !dm || !MONTH_EN[dm[1]]) continue;
    const [, region, kind, reg] = rel;
    const y = Number(dm[3]), mo = MONTH_EN[dm[1]];
    // Palvelin palauttaa välillä tyhjän vastauksen, jos pyyntöjä tulee tiheään: yritetään uudelleen
    let buf = Buffer.alloc(0);
    for (let i = 0; i < 3 && buf.length < 1000; i++) {
      if (i) await new Promise(res => setTimeout(res, 10000 * i));
      const pr = await fetch(`https://www.pmi.spglobal.com/Public/Home/PressRelease/${m[3]}`, { headers: UA, signal: AbortSignal.timeout(30000) });
      buf = Buffer.from(await pr.arrayBuffer());
    }
    if (buf.length < 1000) { console.log(`  S&P: tyhjä vastaus (${title})`); continue; }
    const txt = pdfText(buf);
    if (kind === 'flash') {
      const f = txt.match(new RegExp(`Flash ${reg} Manufacturing PMI[^:\\n]*: ?(\\d\\d\\.\\d) ?\\n? ?\\(\\w+: ?(\\d\\d\\.\\d)\\)`));
      if (!f) { console.log(`  S&P: lukua ei löytynyt (${title})`); continue; }
      spgSet(region, `${y}-${String(mo).padStart(2, '0')}`, Number(f[1]), true);
      spgSet(region, prevMonth(y, mo), Number(f[2]), false);
    } else {
      const f = txt.match(new RegExp(`${reg} Manufacturing PMI[^\\n]{0,40}? at (\\d\\d\\.\\d)`));
      if (!f) { console.log(`  S&P: lukua ei löytynyt (${title})`); continue; }
      spgSet(region, prevMonth(y, mo), Number(f[1]), false);
    }
    read++;
    await new Promise(res => setTimeout(res, 1000));
  }
  if (!read) throw new Error('yhtään PMI-tiedotetta ei saatu luettua');
  for (const k of ['ez', 'us']) spgHist[k].sort((a, b) => a.month.localeCompare(b.month));
  fs.writeFileSync('spg_pmi_history.json', JSON.stringify(spgHist, null, 1) + '\n');
  console.log(`OK  spg-pmi  euroalue ${spgHist.ez.at(-1)?.value}, USA ${spgHist.us.at(-1)?.value} (${read} tiedotetta)`);
  ok('spg');
} catch (e) {
  failed.push('spg-pmi'); notOk('spg');
  console.log(`VIRHE S&P Global PMI: ${e.message} – käytetään tallennettua historiaa`);
}
for (const [region, key, label] of [['ez', 'pmi_ez', 'Euroalue PMI'], ['us', 'pmi_us', 'USA PMI (S&P)']]) {
  if (spgHist[region]?.length >= 2) {
    const s = monthlySeries(spgHist[region], label);
    s.card.flash = Boolean(spgHist[region].at(-1).flash);
    out.macro[key] = s.card;
    out.hist[key] = s.hist;
  }
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
  ok('cli');
} catch (e) {
  failed.push('cli'); notOk('cli');
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
  ok('wci');
} catch (e) {
  failed.push('wci'); notOk('wci');
  console.log(`VIRHE WCI: ${e.message} – käytetään tallennettua historiaa`);
}
if (wciHist.length) {
  const h = wciHist;
  const latest = h.at(-1), prev = h.at(-2);
  out.wci = {
    d: h.map(p => p.date),
    v: h.map(p => p.value),
    latest: latest.value,
    date: latest.date,
    changePct: prev ? round((latest.value / prev.value - 1) * 100, 1) : null,
  };
}

// ── Seurantalista ───────────────────────────────────────────
// Lisää tai poista rivejä tästä. sym = Yahoo Finance -tunnus (ETF:t Xetrasta EUR-hinnoin kuten Nordnetissa).
const WATCHLIST = [
  { sym: 'TSM',     name: 'Taiwan Semiconductor (ADR)', type: 'Osake' },
  { sym: 'ASML.AS', name: 'ASML Holding',               type: 'Osake' },
  { sym: 'META',    name: 'Meta Platforms A',           type: 'Osake' },
  { sym: 'MSFT',    name: 'Microsoft',                  type: 'Osake' },
  { sym: 'GOOGL',   name: 'Alphabet A',                 type: 'Osake' },
  { sym: 'GOOG',    name: 'Alphabet C',                 type: 'Osake' },
  { sym: 'AMZN',    name: 'Amazon.com',                 type: 'Osake' },
  { sym: 'ORCL',    name: 'Oracle',                     type: 'Osake' },
  { sym: 'NVDA',    name: 'NVIDIA',                     type: 'Osake' },
  { sym: 'AVGO',    name: 'Broadcom',                   type: 'Osake' },
  { sym: 'AMD',     name: 'Advanced Micro Devices',     type: 'Osake' },
  { sym: 'XAIX.DE', name: 'Xtrackers AI & Big Data UCITS ETF 1C',  type: 'ETF' },
  { sym: 'WTI2.DE', name: 'WisdomTree AI UCITS ETF USD Acc',       type: 'ETF' },
  { sym: 'XMLD.DE', name: 'L&G Artificial Intelligence ETF',       type: 'ETF' },
  { sym: 'USMC.DE', name: 'Franklin US Mega Cap 100 UCITS ETF',    type: 'ETF' },
  { sym: 'SNP1.DE', name: 'L&G S&P 100 UCITS ETF USD Acc',         type: 'ETF' },
  { sym: 'IS20.DE', name: 'iShares S&P 500 Top 20 ETF USD Acc',    type: 'ETF' },
];

const pct = (a, b) => (a != null && b ? round((a / b - 1) * 100, 1) : null);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const fmtFi = (x, d = 1) => x.toFixed(d).replace('.', ',').replace('-', '−');

// Lyhyt sääntöpohjainen kuvaus kurssikehityksestä. Ei sijoitussuositus.
function analyse(w, bench1m) {
  const s = [];
  if (w.ma50 && w.ma200) {
    if (w.price > w.ma50 && w.price > w.ma200) s.push('Nouseva trendi: kurssi on 50 ja 200 päivän keskiarvon yläpuolella.');
    else if (w.price < w.ma50 && w.price < w.ma200) s.push('Laskeva trendi: kurssi on 50 ja 200 päivän keskiarvon alapuolella.');
    else if (w.price > w.ma200) s.push('Pitkä trendi on nouseva, mutta kurssi on painunut alle 50 päivän keskiarvon.');
    else s.push('Kurssi on noussut yli 50 päivän keskiarvon, mutta on vielä alle 200 päivän keskiarvon.');
  }
  if (w.fromHigh != null) {
    if (w.fromHigh > -3) s.push('Kurssi on lähellä vuoden huippuaan.');
    else if (w.fromHigh < -20) s.push(`Kurssi on ${fmtFi(-w.fromHigh, 0)} % alle vuoden huipun.`);
  }
  if (w.m1 != null && bench1m != null) {
    const d = w.m1 - bench1m;
    if (d > 5) s.push(`Kuukaudessa ${fmtFi(d, 0)} %-yks. S&P 500 -indeksiä paremmin.`);
    else if (d < -5) s.push(`Kuukaudessa ${fmtFi(-d, 0)} %-yks. S&P 500 -indeksiä heikommin.`);
    else s.push('Kuukauden kehitys on ollut markkinan tahdissa.');
  }
  if (w.day != null && Math.abs(w.day) >= 5) s.push(`Viimeisin päivä oli poikkeuksellinen (${w.day > 0 ? '+' : ''}${fmtFi(w.day)} %).`);
  if (w.vol != null && w.vol > 55) s.push(`Kurssi heiluu paljon (vuositasolla n. ${fmtFi(w.vol, 0)} %).`);
  return s.join(' ');
}

const watch = [];
let bench1m = null;
try {
  const b = await yahoo('^GSPC', '3mo', '1d');
  const c = b.points.map(p => p.close);
  bench1m = pct(c.at(-1), c.at(-22));
} catch { /* ilman vertailua */ }
for (const it of WATCHLIST) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(it.sym)}?range=1y&interval=1d`;
    const res = (await fetchJson(url)).chart.result[0];
    const pts = res.timestamp.map((t, i) => ({ t: t * 1000, c: res.indicators.quote[0].close[i] })).filter(p => p.c != null);
    const c = pts.map(p => p.c);
    const price = res.meta.regularMarketPrice ?? c.at(-1);
    const yearStart = pts.findIndex(p => new Date(p.t).getUTCFullYear() === now.getUTCFullYear());
    const rets = c.slice(-31).map((x, i, a) => (i ? Math.log(x / a[i - 1]) : null)).slice(1);
    const sd = Math.sqrt(mean(rets.map(r => (r - mean(rets)) ** 2)));
    const w = {
      sym: it.sym, name: it.name, type: it.type, currency: res.meta.currency,
      price: round(price, 2),
      day: pct(price, c.at(-2)),
      w1: pct(price, c.at(-6)),
      m1: pct(price, c.at(-22)),
      ytd: yearStart > 0 ? pct(price, c[yearStart - 1]) : null,
      y1: pct(price, c[0]),
      high52: round(Math.max(...c), 2),
      low52: round(Math.min(...c), 2),
      ma50: c.length >= 50 ? round(mean(c.slice(-50)), 2) : null,
      ma200: c.length >= 200 ? round(mean(c.slice(-200)), 2) : null,
      vol: round(sd * Math.sqrt(252) * 100, 0),
      spark: c.slice(-63).map(x => round(x, 2)),
    };
    w.fromHigh = pct(price, w.high52);
    w.text = analyse(w, bench1m);
    watch.push(w);
    ok('watch:' + it.sym);
  } catch (e) {
    console.log(`VIRHE seuranta ${it.sym}: ${e.message}`);
    const o = old.watch?.items?.find(x => x.sym === it.sym);
    notOk('watch:' + it.sym);
    if (o) watch.push(o);
  }
}
if (watch.length) {
  const stocks = watch.filter(w => w.type === 'Osake' && w.m1 != null);
  const up = watch.filter(w => w.ma50 && w.price > w.ma50).length;
  const best = [...watch].filter(w => w.m1 != null).sort((a, b) => b.m1 - a.m1);
  const parts = [];
  if (stocks.length) parts.push(`Seurattujen osakkeiden kurssit ovat muuttuneet kuukaudessa keskimäärin ${stocks.length && mean(stocks.map(w => w.m1)) >= 0 ? '+' : ''}${fmtFi(mean(stocks.map(w => w.m1)))} %${bench1m != null ? ` (S&P 500 ${bench1m >= 0 ? '+' : ''}${fmtFi(bench1m)} %)` : ''}.`);
  parts.push(`${up}/${watch.length} on 50 päivän keskiarvonsa yläpuolella.`);
  if (best.length >= 2) parts.push(`Kuukauden vahvin: ${best[0].name} (${best[0].m1 >= 0 ? '+' : ''}${fmtFi(best[0].m1)} %), heikoin: ${best.at(-1).name} (${best.at(-1).m1 >= 0 ? '+' : ''}${fmtFi(best.at(-1).m1)} %).`);
  out.watch = { summary: parts.join(' '), bench1m, items: watch };
  console.log(`OK  seuranta ${watch.length}/${WATCHLIST.length}`);
}

// ── Tallennus ───────────────────────────────────────────────
const total = Object.keys(SYMBOLS).length + 6;
if (failed.length >= total) {
  console.error('Kaikki lähteet epäonnistuivat – data.js:ää ei muutettu.');
  process.exit(1);
}
out.fresh = fresh;
fs.writeFileSync('data.js',
  '// Generoitu tiedosto (update_data.mjs) – älä muokkaa käsin.\n' +
  `window.MK_DATA = ${JSON.stringify(out)};\n`);
console.log(failed.length ? `Valmis, mutta epäonnistui: ${failed.join(', ')}` : 'Kaikki valmis!');
