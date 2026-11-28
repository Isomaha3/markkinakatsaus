// ISM Manufacturing PMI -tiedotteen otsikon jäsennys.
// Esimerkki: "Manufacturing PMI® at 55.5%; October 2026 ISM® Manufacturing PMI® Report"
// Palauttaa { month: 'YYYY-MM', value } tai null, jos otsikko ei ole teollisuuden PMI-tiedote.

const MONTH_EN = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7,
  August: 8, September: 9, October: 10, November: 11, December: 12 };

export function parseIsmTitle(title) {
  if (!/Manufacturing/.test(title) || /Non-Manufacturing|Services|Hospital|Semiannual|Forecast/i.test(title)) return null;
  const v = title.match(/PMI®? (?:at|registers|registered) ([\d.]+)%/);
  const m = title.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/);
  if (!v || !m) return null;
  const value = Number(v[1]);
  if (!(value >= 25 && value <= 75)) return null; // epäuskottava
  return { month: `${m[2]}-${String(MONTH_EN[m[1]]).padStart(2, '0')}`, value };
}
