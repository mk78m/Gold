import json
import re
import time
import urllib.request
import urllib.parse
import datetime as dt
import html
from pathlib import Path

# ============================================================
# Gold Iran collector
#
# Keeps the existing live 5-minute snapshot system and fixes
# historical OHLC collection by using TGJU's public data endpoint
# instead of trying to parse the visible HTML table.
#
# The endpoint returns the daily OHLC table used by TGJU itself.
# 5000 rows is enough to cover more than 10 years of daily records
# for this market. We never invent candles.
# ============================================================

TGJU_HISTORY_API = (
    "https://api.tgju.org/v1/market/indicator/"
    "summary-table-data/geram18"
)

TGJU_HISTORY_PAGE = "https://www.tgju.org/profile/geram18/history"

TGJU_LIVE = (
    "https://r.jina.ai/"
    "https://www.tgju.org/profile/tgju_gold_irg18"
)

OUT = Path("data/market.json")

# Requested archive window: 10 years.
CUTOFF_DATE = dt.date.today() - dt.timedelta(days=3652)
CUTOFF = CUTOFF_DATE.isoformat()

HISTORY_ROWS = 5000


def fetch(url, params=None, timeout=45):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/140 Safari/537.36"
            ),
            "Accept": (
                "application/json, text/javascript, "
                "application/xhtml+xml, text/html;q=0.9,*/*;q=0.8"
            ),
            "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
            "Origin": "https://www.tgju.org",
            "Referer": "https://www.tgju.org/",
        },
    )

    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8", "ignore")


def clean_number(value):
    if value is None:
        return None

    text = html.unescape(str(value))

    text = text.translate(
        str.maketrans(
            "۰۱۲۳۴۵۶۷۸۹",
            "0123456789",
        )
    )

    text = (
        text.replace("٬", "")
        .replace(",", "")
        .replace(" ", "")
        .replace("\u200c", "")
    )

    # Remove HTML tags if the API wraps a change field in HTML.
    text = re.sub(r"<[^>]+>", "", text)

    match = re.search(r"-?\d+(?:\.\d+)?", text)

    if not match:
        return None

    number = float(match.group())

    if number.is_integer():
        return int(number)

    return number


def iso_date(value):
    if value is None:
        return None

    text = html.unescape(str(value))

    match = re.search(
        r"(20\d{2})[/-](\d{1,2})[/-](\d{1,2})",
        text,
    )

    if not match:
        return None

    year, month, day = (
        int(match.group(1)),
        int(match.group(2)),
        int(match.group(3)),
    )

    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None


def build_history_params(length=HISTORY_ROWS):
    """
    Parameters used by TGJU's own DataTables history endpoint.
    """
    params = [
        ("lang", "fa"),
        ("order_dir", "asc"),
        ("draw", "2"),
    ]

    for i in range(8):
        params.extend(
            [
                (f"columns[{i}][data]", str(i)),
                (f"columns[{i}][name]", ""),
                (f"columns[{i}][searchable]", "true"),
                (f"columns[{i}][orderable]", "true"),
                (f"columns[{i}][search][value]", ""),
                (f"columns[{i}][search][regex]", "false"),
            ]
        )

    params.extend(
        [
            ("start", "0"),
            ("length", str(length)),
            ("search", ""),
            ("order_col", ""),
            ("order_dir", ""),
            ("from", ""),
            ("to", ""),
            ("convert_to_ad", "1"),
            ("_", str(int(time.time() * 1000))),
        ]
    )

    return params


def parse_history_api(payload):
    """
    Convert TGJU API rows into our stable daily JSON schema.

    Expected TGJU row order:
    0 open
    1 low
    2 high
    3 close
    4 change
    5 change %
    6 Gregorian date
    7 Persian date
    """
    if isinstance(payload, str):
        payload = json.loads(payload)

    rows = payload.get("data", [])

    parsed = {}

    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 8:
            continue

        date = iso_date(row[6])

        if not date:
            continue

        open_price = clean_number(row[0])
        low_price = clean_number(row[1])
        high_price = clean_number(row[2])
        close_price = clean_number(row[3])

        if None in (
            open_price,
            low_price,
            high_price,
            close_price,
        ):
            continue

        parsed[date] = {
            "date": date,
            "open": int(open_price),
            "low": int(low_price),
            "high": int(high_price),
            "close": int(close_price),
            "change": clean_number(row[4]),
            "change_pct": clean_number(row[5]),
            "source": "TGJU",
        }

    return parsed


def parse_history_html(text):
    """
    Fallback parser for the visible TGJU history table.
    It is intentionally tolerant and does not replace the API.
    """
    out = {}

    # Extract table rows first.
    rows = re.findall(
        r"<tr\b[^>]*>(.*?)</tr>",
        text,
        flags=re.I | re.S,
    )

    for row in rows:
        cells = re.findall(
            r"<td\b[^>]*>(.*?)</td>",
            row,
            flags=re.I | re.S,
        )

        if len(cells) < 8:
            continue

        values = [
            re.sub(r"<[^>]+>", " ", html.unescape(x))
            .replace("\n", " ")
            .strip()
            for x in cells
        ]

        date = iso_date(values[6])

        if not date:
            continue

        nums = [clean_number(x) for x in values[:6]]

        if any(x is None for x in nums[:4]):
            continue

        out[date] = {
            "date": date,
            "open": int(nums[0]),
            "low": int(nums[1]),
            "high": int(nums[2]),
            "close": int(nums[3]),
            "change": nums[4],
            "change_pct": nums[5],
            "source": "TGJU",
        }

    return out


def get_current_price(text):
    patterns = [
        r"(?:نرخ فعلی|قیمت فعلی)[\s\S]{0,500}?([0-9۰-۹,٬]{7,})",
        r"(?<!\d)(\d{3},\d{3},\d{3})(?!\d)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text)

        if match:
            value = clean_number(match.group(1))

            if value is not None:
                return int(value)

    raise RuntimeError(
        "Current TGJU gold price was not found."
    )


def load():
    if OUT.exists():
        try:
            return json.loads(
                OUT.read_text(encoding="utf-8")
            )
        except Exception:
            # Never destroy a working deployment because JSON is
            # temporarily malformed.
            pass

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
    OUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUT.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def archive_covers_requested_period(data):
    daily = data.get("daily", [])

    dates = []

    for row in daily:
        value = row.get("date")

        if value:
            try:
                dates.append(
                    dt.date.fromisoformat(value)
                )
            except ValueError:
                pass

    if not dates:
        return False

    return min(dates) <= CUTOFF_DATE


def bootstrap_tgju_daily(data):
    """
    Download up to 5000 daily OHLC rows from TGJU.

    This is only needed until the local archive reaches the requested
    10-year cutoff. Once it does, subsequent 5-minute runs do not
    repeatedly download the entire history.

    Existing daily records are merged, never deleted.
    """
    if archive_covers_requested_period(data):
        data.setdefault("meta", {})[
            "historical_bootstrap_status"
        ] = "complete"

        return 0

    parsed = {}

    # Primary: TGJU's own history-data endpoint.
    try:
        raw = fetch(
            TGJU_HISTORY_API,
            params=build_history_params(
                HISTORY_ROWS
            ),
            timeout=60,
        )

        payload = json.loads(raw)
        parsed = parse_history_api(payload)

    except Exception as exc:
        print(
            "TGJU history API warning:",
            repr(exc),
        )

    # Fallback: visible history page.
    if not parsed:
        try:
            text = fetch(
                TGJU_HISTORY_PAGE,
                timeout=45,
            )

            parsed = parse_history_html(text)

        except Exception as exc:
            print(
                "TGJU history page warning:",
                repr(exc),
            )

    # Do not fail the entire live collector if history is
    # temporarily unavailable. Existing good data is preserved.
    if not parsed:
        data.setdefault("meta", {})[
            "historical_bootstrap_status"
        ] = "temporarily_unavailable"

        print(
            "WARNING: no new historical OHLC rows were received. "
            "Existing archive was preserved."
        )

        return 0

    existing = {
        row["date"]: row
        for row in data.get("daily", [])
        if row.get("date")
    }

    existing.update(parsed)

    data["daily"] = sorted(
        existing.values(),
        key=lambda row: row["date"],
    )

    dates = [
        row["date"]
        for row in data["daily"]
        if row.get("date")
    ]

    data.setdefault("meta", {})

    if dates:
        data["meta"]["tgju_daily_first_date"] = dates[0]
        data["meta"]["tgju_daily_last_date"] = dates[-1]

    data["meta"]["requested_history_start"] = CUTOFF
    data["meta"]["historical_rows_received"] = len(parsed)
    data["meta"]["historical_bootstrap_status"] = (
        "complete"
        if dates and dates[0] <= CUTOFF
        else "partial"
    )
    data["meta"]["daily_history_note"] = (
        "Daily OHLC comes from TGJU. "
        "No synthetic candles are created."
    )

    return len(parsed)


def add_live_snapshot(data):
    text = fetch(
        TGJU_LIVE,
        timeout=45,
    )

    price = get_current_price(text)

    now = dt.datetime.now(
        dt.timezone.utc
    ).replace(
        second=0,
        microsecond=0,
    )

    bucket = now.replace(
        minute=(now.minute // 5) * 5
    )

    timestamp = bucket.isoformat().replace(
        "+00:00",
        "Z",
    )

    rows = data.setdefault(
        "intraday_5m",
        [],
    )

    rows = [
        row
        for row in rows
        if row.get("time") != timestamp
    ]

    rows.append(
        {
            "time": timestamp,
            "price": price,
            "source": "TGJU",
        }
    )

    data["intraday_5m"] = rows[-50000:]

    # Keep a compact close-only archive for consumers that do not need OHLC.
    # The daily OHLC itself remains the authoritative historical series.
    data["history_10y_close"] = [
        {"date": r["date"], "close": r["close"], "source": r.get("source", "TGJU")}
        for r in data.get("daily", [])
        if r.get("date") and r.get("close") is not None
    ]

    data["updated_at"] = (
        now.isoformat().replace(
            "+00:00",
            "Z",
        )
    )


def main():
    data = load()

    # Historical archive is attempted first.
    # It no longer kills the live system if the history endpoint
    # is temporarily unavailable.
    historical_count = bootstrap_tgju_daily(
        data
    )

    # Existing live/snapshot functionality remains.
    add_live_snapshot(data)

    data.setdefault("meta", {})

    data["meta"]["collection_interval"] = "5 minutes"
    data["meta"]["historical_cutoff_requested"] = CUTOFF
    data["meta"]["candles_are_synthetic"] = False
    data["meta"]["intraday_snapshot_interval"] = "5 minutes"
    data["meta"]["intraday_candle_method"] = "OHLC aggregated from observed 5-minute snapshots"
    data["meta"]["daily_candle_method"] = "TGJU real OHLC only"
    data["meta"]["indicator_ready"] = {
        "rsi": 14,
        "macd": {"fast": 12, "slow": 26, "signal": 9},
        "adx": 14,
        "sma": [20, 50]
    }
    data["meta"]["last_historical_update_count"] = (
        historical_count
    )

    save(data)

    print(
        "Collector completed successfully."
    )
    print(
        "Historical rows merged:",
        historical_count,
    )
    print(
        "Daily rows stored:",
        len(data.get("daily", [])),
    )
    print(
        "5-minute snapshots stored:",
        len(data.get("intraday_5m", [])),
    )


if __name__ == "__main__":
    main()
