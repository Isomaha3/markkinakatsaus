// USA:n 10 v koron kuukausikeskiarvo, jotta se on vertailukelpoinen EKP:n kuukausikeskiarvojen kanssa.
//
// daily:  { d: ['YYYY-MM-DD', ...], v: [...] }  päivän päätöskurssit (noin vuoden ajalta)
// weekly: { d: [...], v: [...] }                viikon päätöskurssit (10 vuoden ajalta)
// currentMonth: 'YYYY-MM' – kesken oleva kuukausi jätetään pois, koska siitä on vain osa havainnoista.
//
// Kuukaudet, jotka päivädata kattaa kokonaan, lasketaan päivädatasta. Muut kuukaudet lasketaan
// viikkodatasta. Sarjan ensimmäinen kuukausi jätetään pois, jos data alkaa kesken kuun.
// Palauttaa { d: ['YYYY-MM-01', ...], v: [...] } tai null, jos dataa ei ole.

const avg = a => Number((a.reduce((s, x) => s + x, 0) / a.length).toFixed(2));

function groupByMonth(sr) {
  const byM = {};
  if (!sr?.d) return byM;
  sr.d.forEach((d, i) => {
    const v = sr.v[i];
    if (v != null && Number.isFinite(v)) (byM[d.slice(0, 7)] ??= []).push(v);
  });
  return byM;
}

// Kuukausi on kokonainen, jos sarja alkaa viimeistään kuun 7. päivänä (viikon sisällä alusta)
// tai on alkanut jo aiemmin.
function firstFullMonth(sr) {
  if (!sr?.d?.length) return null;
  const first = sr.d[0];
  if (Number(first.slice(8, 10)) <= 7) return first.slice(0, 7);
  const [y, m] = first.slice(0, 7).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function usMonthlyAverage(daily, weekly, currentMonth) {
  const dByM = groupByMonth(daily), wByM = groupByMonth(weekly);
  const dFrom = firstFullMonth(daily), wFrom = firstFullMonth(weekly);
  const months = [...new Set([...Object.keys(dByM), ...Object.keys(wByM)])]
    .filter(m => m < currentMonth)
    .sort();
  const d = [], v = [];
  for (const m of months) {
    let src = null;
    if (dFrom && m >= dFrom && dByM[m]) src = dByM[m];
    else if (wFrom && m >= wFrom && wByM[m]) src = wByM[m];
    if (!src) continue;
    d.push(`${m}-01`);
    v.push(avg(src));
  }
  return d.length ? { d, v } : null;
}
