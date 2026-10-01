import json
import re
import time
import urllib.request
import datetime as dt
from pathlib import Path

# ============================================================
# Gold Iran collector — keeps the current live/snapshot system
# and adds a safe historical bootstrap.
#
# IMPORTANT:
# TGJU officially exposes daily OHLC history. Its public history
# page currently starts at 2018 for this symbol. Therefore this
# script NEVER invents OHLC candles for 2016-2018.
#
# 2018 -> today: real TGJU daily OHLC
# 2016 -> 2018: optional close-only history from a separate
# free historical source can be stored under history_10y_close.
# ============================================================

TGJU_HISTORY = "https://www.tgju.org/profile/geram18/history"
TGJU_LIVE = "https://r.jina.ai/https://www.tgju.org/profile/tgju_gold_irg18"
OUT = Path("data/market.json")
CUTOFF = (dt.date.today() - dt.timedelta(days=3652)).isoformat()


def fetch(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; GoldIranCollector/2.0)"
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def clean_number(s):
    digits = str(s).translate(str.maketrans(
        "۰۱۲۳۴۵۶۷۸۹",
        "0123456789"
    ))
    digits = digits.replace("٬", "").replace(",", "").replace(" ", "")
    m = re.search(r"-?\d+(?:\.\d+)?", digits)
    return float(m.group()) if m else None


def iso_date(s):
    m = re.search(r"(20\d{2})[/-](\d{2})[/-](\d{2})", s)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def parse_tgju_history(text):
    """
    TGJU history pages expose:
    Opening | Low | High | Close | Change | Change % | Gregorian | Persian
    """
    out = {}

    # Markdown/text extraction is intentionally tolerant of whitespace.
    pattern = re.compile(
        r"([0-9۰-۹,٬]+)\s*\|\s*"
        r"([0-9۰-۹,٬]+)\s*\|\s*"
        r"([0-9۰-۹,٬]+)\s*\|\s*"
        r"([0-9۰-۹,٬]+)\s*\|\s*"
        r"([+-]?[0-9۰-۹,٬.]+)\s*\|\s*"
        r"([+-]?[0-9۰-۹,٬.]+)%\s*\|\s*"
        r"(20\d{2}/\d{2}/\d{2})"
    )

    for m in pattern.finditer(text):
        d = iso_date(m.group(7))
        if not d:
            continue

        # TGJU quotes IRR. Keep source unit exactly as published.
        row = {
            "date": d,
            "open": int(clean_number(m.group(1))),
            "low": int(clean_number(m.group(2))),
            "high": int(clean_number(m.group(3))),
            "close": int(clean_number(m.group(4))),
            "change": clean_number(m.group(5)),
            "change_pct": clean_number(m.group(6)),
            "source": "TGJU",
        }

        out[d] = row

    return out


def get_current_price(text):
    patterns = [
        r"(?:نرخ فعلی|قیمت فعلی)[\s\S]{0,500}?([0-9۰-۹,٬]{7,})",
        r"(?<!\d)(\d{3},\d{3},\d{3})(?!\d)",
    ]

    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return int(clean_number(m.group(1)))

    raise RuntimeError("Current TGJU gold price was not found")


def load():
    if OUT.exists():
        return json.loads(OUT.read_text(encoding="utf-8"))

    return {
        "schema": "gold-iran-market-v3",
        "updated_at": None,
        "source": "TGJU",
        "symbol": "IRG18",
        "currency": "IRR",
        "unit": "gram",
        "daily": [],
        "intraday_5m": [],
        "history_10y_close": [],
        "meta": {},
    }


def save(data):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def bootstrap_tgju_daily(data):
    """
    Fetch the public TGJU history page.

    The public page is authoritative for the OHLC fields it exposes.
    We merge rather than replace, so a temporary upstream failure cannot
    erase a working local archive.

    If a future TGJU pagination/API endpoint becomes available, this
    function is the only place that needs to be extended.
    """
    text = fetch(TGJU_HISTORY)
    parsed = parse_tgju_history(text)

    if not parsed:
        raise RuntimeError(
            "TGJU history page returned no parseable OHLC rows."
        )

    existing = {
        x["date"]: x
        for x in data.get("daily", [])
        if x.get("date")
    }

    existing.update(parsed)

    # Do not claim 10 years if the source did not provide it.
    data["daily"] = sorted(
        existing.values(),
        key=lambda x: x["date"]
    )

    dates = [x["date"] for x in data["daily"]]

    data["meta"]["tgju_daily_first_date"] = dates[0]
    data["meta"]["tgju_daily_last_date"] = dates[-1]
    data["meta"]["requested_history_start"] = CUTOFF
    data["meta"]["daily_history_note"] = (
        "Only source-provided OHLC is stored. No synthetic candles."
    )


def add_live_snapshot(data):
    text = fetch(TGJU_LIVE)
    price = get_current_price(text)

    now = dt.datetime.now(dt.timezone.utc).replace(
        second=0,
        microsecond=0
    )

    bucket = now.replace(
        minute=(now.minute // 5) * 5
    )

    timestamp = bucket.isoformat().replace("+00:00", "Z")

    rows = data.setdefault("intraday_5m", [])

    rows = [
        x for x in rows
        if x.get("time") != timestamp
    ]

    rows.append({
        "time": timestamp,
        "price": price,
        "source": "TGJU",
    })

    # Keep a large but bounded local archive.
    data["intraday_5m"] = rows[-20000:]
    data["updated_at"] = now.isoformat().replace("+00:00", "Z")


def main():
    data = load()

    # Historical OHLC is refreshed without deleting existing good data.
    bootstrap_tgju_daily(data)

    # Existing live/snapshot functionality remains.
    add_live_snapshot(data)

    data["meta"]["collection_interval"] = "5 minutes"
    data["meta"]["historical_cutoff_requested"] = CUTOFF
    data["meta"]["candles_are_synthetic"] = False

    save(data)


if __name__ == "__main__":
    main()
