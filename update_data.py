import yfinance as yf
import requests
import json
import re
from datetime import datetime, timedelta
 
FRED_KEY = '3108436ca593495294aa12a66695b9e8'
FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
 
def get_weekly_closes(symbol, weeks=52):
    """Hae viikoittaiset sulkemisarvot Yahoo Financesta."""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1y", interval="1wk")
        closes = [round(float(x), 2) for x in hist['Close'].tail(weeks).tolist()]
        return closes if len(closes) >= 10 else None
    except Exception as e:
        print(f"Yahoo virhe {symbol}: {e}")
        return None
 
def get_fred(series_id, limit=13):
    """Hae kuukausittainen data FRED:stä."""
    try:
        url = f"{FRED_BASE}?series_id={series_id}&api_key={FRED_KEY}&file_type=json&sort_order=desc&limit={limit}"
        r = requests.get(url, timeout=15)
        d = r.json()
        obs = [o for o in d['observations'] if o['value'] != '.']
        obs.reverse()  # vanhimmasta uusimpaan
        values = [round(float(o['value']), 2) for o in obs]
        dates  = [datetime.strptime(o['date'], '%Y-%m-%d').strftime("%-m'%y") for o in obs]
        return {'values': values, 'dates': dates, 'latest': values[-1], 'prev': values[-2]}
    except Exception as e:
        print(f"FRED virhe {series_id}: {e}")
        return None
 
print("Haetaan dataa Yahoo Financesta...")
 
# Yahoo Finance data
sp500  = get_weekly_closes("SPY")
omxh   = get_weekly_closes("^OMXH25")
stoxx  = get_weekly_closes("EXW1.DE")
wti    = get_weekly_closes("CL=F")
brent  = get_weekly_closes("BZ=F")
gold   = get_weekly_closes("GC=F")
copper = get_weekly_closes("HG=F")
vix    = get_weekly_closes("^VIX")
tnx    = get_weekly_closes("^TNX")
 
# Skaalaa S&P 500 (SPY * 10)
if sp500:
    sp500 = [round(x * 10, 0) for x in sp500]
 
print("Haetaan FRED-data...")
 
# FRED data
uspmi = get_fred('NAPM', 13)       # US Manufacturing PMI
gcli  = get_fred('BSCICP03USM665S', 13)  # OECD CLI
 
print(f"S&P 500: {sp500[-1] if sp500 else 'VIRHE'}")
print(f"OMXH25: {omxh[-1] if omxh else 'VIRHE'}")
print(f"WTI: {wti[-1] if wti else 'VIRHE'}")
print(f"US PMI: {uspmi['latest'] if uspmi else 'VIRHE'}")
print(f"OECD CLI: {gcli['latest'] if gcli else 'VIRHE'}")
 
# Lue index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
 
# Päivitä päivämäärä
today = datetime.now().strftime('%d.%m.%Y')
content = re.sub(
    r'// Viimeksi päivitetty: [\d.]+',
    f'// Viimeksi päivitetty: {today}',
    content
)
 
def format_list(data):
    if not data:
        return None
    return '[' + ','.join(str(x) for x in data) + ']'
 
# Päivitä WEEKLY-graafidata
replacements = {
    'omxh':   omxh,
    'sp500':  sp500,
    'stoxx':  stoxx,
    'wti':    wti,
    'brent':  brent,
    'gold':   gold,
    'copper': copper,
    'vix':    vix,
    'tnx':    tnx,
}
 
for key, data in replacements.items():
    if data and len(data) >= 10:
        new_list = format_list(data)
        pattern = rf'(\s+{key}:\s*)\[[\d.,\s]+\]'
        new_content = re.sub(pattern, rf'\g<1>{new_list}', content)
        if new_content != content:
            content = new_content
            print(f"Päivitetty: {key}")
        else:
            print(f"EI LÖYDY: {key}")
 
# Päivitä FRED_USPMI
if uspmi:
    content = re.sub(
        r'(const FRED_USPMI = \{[^}]*latest:\s*)[\d.]+',
        rf'\g<1>{uspmi["latest"]}',
        content
    )
    content = re.sub(
        r'(const FRED_USPMI = \{[^}]*prev:\s*)[\d.]+',
        rf'\g<1>{uspmi["prev"]}',
        content
    )
    new_dates  = format_list([f"'{d}'" for d in uspmi['dates']])
    new_values = format_list(uspmi['values'])
    content = re.sub(
        r'(FRED_USPMI = \{[^}]*dates:\s*)\[[^\]]+\]',
        rf'\g<1>{new_dates}',
        content, flags=re.DOTALL
    )
    content = re.sub(
        r'(FRED_USPMI = \{[^}]*values:\s*)\[[^\]]+\]',
        rf'\g<1>{new_values}',
        content, flags=re.DOTALL
    )
    print(f"Päivitetty: FRED_USPMI ({uspmi['latest']})")
 
# Päivitä FRED_GCLI
if gcli:
    content = re.sub(
        r'(const FRED_GCLI = \{[^}]*latest:\s*)[\d.]+',
        rf'\g<1>{gcli["latest"]}',
        content
    )
    content = re.sub(
        r'(const FRED_GCLI = \{[^}]*prev:\s*)[\d.]+',
        rf'\g<1>{gcli["prev"]}',
        content
    )
    new_dates  = format_list([f"'{d}'" for d in gcli['dates']])
    new_values = format_list(gcli['values'])
    content = re.sub(
        r'(FRED_GCLI = \{[^}]*dates:\s*)\[[^\]]+\]',
        rf'\g<1>{new_dates}',
        content, flags=re.DOTALL
    )
    content = re.sub(
        r'(FRED_GCLI = \{[^}]*values:\s*)\[[^\]]+\]',
        rf'\g<1>{new_values}',
        content, flags=re.DOTALL
    )
    print(f"Päivitetty: FRED_GCLI ({gcli['latest']})")
 
# Tallenna
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
 
print("Kaikki valmis!")
 
