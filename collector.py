import json,re,urllib.request,datetime
from pathlib import Path

URL="https://r.jina.ai/https://www.tgju.org/profile/tgju_gold_irg18"
OUT=Path("data/market.json")

def fetch():
    req=urllib.request.Request(URL,headers={"User-Agent":"Mozilla/5.0"})
    return urllib.request.urlopen(req,timeout=25).read().decode("utf-8","ignore")

def num(s):
    return int(re.sub(r"[^\d]","",s))

def price(text):
    m=re.search(r"(?:نرخ فعلی|قیمت فعلی)[\s\S]{0,500}?([\d,]{7,})",text)
    if not m:
        # fallback: first large comma-separated number after profile title
        ms=re.findall(r"(?<!\d)(\d{3},\d{3},\d{3})(?!\d)",text)
        if not ms: raise RuntimeError("Current price not found")
        return num(ms[0])
    return num(m.group(1))

def main():
    data=json.loads(OUT.read_text(encoding="utf-8"))
    p=price(fetch())
    now=datetime.datetime.now(datetime.timezone.utc).replace(second=0,microsecond=0).isoformat().replace("+00:00","Z")
    arr=data.setdefault("intraday_5m",[])
    # Store one observation per 5-minute bucket.
    dt=datetime.datetime.fromisoformat(now.replace("Z","+00:00"))
    bucket=dt.replace(minute=(dt.minute//5)*5,second=0,microsecond=0).isoformat().replace("+00:00","Z")
    arr=[x for x in arr if x.get("time")!=bucket]
    arr.append({"time":bucket,"price":p})
    arr=arr[-20000:]
    data["intraday_5m"]=arr
    data["updated_at"]=now
    OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")

if __name__=="__main__": main()
