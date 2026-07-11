import re
import urllib.request

URL = "http://www.vneremote.com/vne/lista/"
req = urllib.request.Request(
    URL,
    headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": "http://www.vneremote.com/vne/",
    },
)
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8", "ignore")
        print("final", r.geturl())
        print("len", len(html))
        print("login", "username" in html.lower() and "password" in html.lower())
        for pat in [
            r"VIRTUO\d+",
            r"online|offline|on-line|off-line",
            r"lista",
        ]:
            ms = re.findall(pat, html, re.I)
            print(pat, len(ms), ms[:8])
        for m in re.finditer(r'href="([^"]*VIRTUO[^"]*)"', html, re.I):
            print("href", m.group(1)[:120])
        for m in re.finditer(r"<tr[^>]*>.*?</tr>", html, re.I | re.S):
            row = m.group(0)
            if "virtuo" in row.lower() or "risacca" in row.lower():
                text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", row)).strip()
                print("ROW", text[:200])
        print("snippet", re.sub(r"\s+", " ", html)[:1200])
except Exception as e:
    print("ERR", e)
