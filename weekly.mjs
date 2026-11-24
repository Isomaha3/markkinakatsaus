// 10 v viikkosarjan viimeistely.
//
// Yahoo merkitsee viikkopisteen viikon alkupäivälle, ja update_data.mjs siirtää sen viikon perjantaille.
// Kesken olevasta viikosta Yahoo palauttaa usein kaksi pistettä, jolloin toinen niistä päätyy
// tulevalle perjantaille vanhentuneella arvolla. Siksi kaikki pisteet, joiden päivä on sama tai
// myöhempi kuin viimeisin kaupankäyntipäivä, pudotetaan, ja sarjan loppuun lisätään yksi piste:
// viimeisin päivä ja sama arvo kuin kortissa.
//
// hist: { d: ['YYYY-MM-DD', ...], v: [...] }, lastDate: 'YYYY-MM-DD', lastValue: luku
// Palauttaa uuden { d, v } -sarjan, joka on aikajärjestyksessä eikä sisällä tulevia päiviä.

export function finishWeekly(hist, lastDate, lastValue) {
  const d = [], v = [];
  (hist?.d ?? []).forEach((x, i) => {
    if (x < lastDate) { d.push(x); v.push(hist.v[i]); }
  });
  d.push(lastDate);
  v.push(lastValue);
  return { d, v };
}
