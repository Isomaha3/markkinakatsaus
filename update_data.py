import yfinance as yf
import json
import re
from datetime import datetime, timedelta

def get_weekly_closes(symbol, weeks=52):
    """Hae viikoittaiset sulkemisarvot."""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1y", interval="1wk")
        closes = [round(float(x), 2) for x in hist['Close'].tail(weeks).tolist()]
        return closes
    except:
        return None

print("Haetaan dataa...")

# Hae data
sp500  = get_weekly_closes("SPY")
omxh   = get_weekly_closes("^OMXH25")
stoxx  = get_weekly_closes("EXW1.DE")
wti    = get_weekly_closes("CL=F")
brent  = get_weekly_closes("BZ=F")
gold   = get_weekly_closes("GC=F")
copper = get_weekly_closes("HG=F")
vix    = get_weekly_closes("^VIX")
tnx    = get_weekly_closes("^TNX")

# Skaalaa S&P 500 oikeaan tasoon (SPY * 10)
if sp500:
    sp500 = [round(x * 10, 0) for x in sp500]

print(f"S&P 500: {sp500[-1] if sp500 else 'VIRHE'}")
print(f"OMXH25: {omxh[-1] if omxh else 'VIRHE'}")
print(f"WTI: {wti[-1] if wti else 'VIRHE'}")

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

def format_list(data, indent=2):
    if not data:
        return None
    items = ','.join(str(x) for x in data)
    return f'[{items}]'

# Päivitä kukin datasarja WEEKLY-osiossa
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
        # Etsi ja korvaa datasarja WEEKLY-objektissa
        pattern = rf'(\s+{key}:\s*)\[[\d.,\s]+\]'
        replacement = rf'\g<1>{new_list}'
        new_content = re.sub(pattern, replacement, content)
        if new_content != content:
            content = new_content
            print(f"Päivitetty: {key}")
        else:
            print(f"EI LÖYDY: {key}")

# Tallenna
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Valmis!")
