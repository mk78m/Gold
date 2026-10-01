#!/usr/bin/env python3
# Gold Terminal Pro - local gateway for index.html
import json, time
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765
UPSTREAM = {
    "/api/gold18": "https://call4.tgju.org/ajax.json",
    "/api/gold18/history": "https://www.tgju.org/profile/geram18/history",
}
CACHE = {}
TTL = {"/api/gold18": 15, "/api/gold18/history": 180}


def fetch_upstream(path):
    now = time.time()
    hit = CACHE.get(path)
    if hit and now - hit[0] < TTL[path]:
        return hit[1], hit[2]
    req = Request(UPSTREAM[path], headers={
        "User-Agent": "Mozilla/5.0 (GoldTerminalPro/1.1)",
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.7",
        "Cache-Control": "no-cache",
        "Referer": "https://www.tgju.org/",
    })
    with urlopen(req, timeout=10) as r:
        data = r.read()
        ctype = r.headers.get_content_type()
    CACHE[path] = (now, data, ctype)
    return data, ctype


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _headers(self, status, ctype, length):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in UPSTREAM:
            try:
                data, ctype = fetch_upstream(path)
                self._headers(200, ctype, len(data))
                self.wfile.write(data)
            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode()
                self._headers(502, "application/json; charset=utf-8", len(body))
                self.wfile.write(body)
            return
        if path == "/api/health":
            body = json.dumps({"ok": True, "service": "gold-terminal-gateway", "time": time.time()}, ensure_ascii=False).encode()
            self._headers(200, "application/json; charset=utf-8", len(body))
            self.wfile.write(body)
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    print(f"Gold Terminal Pro: http://{HOST}:{PORT}/")
    print("Serving: index.html")
    print("TGJU gateway: /api/gold18 and /api/gold18/history")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
