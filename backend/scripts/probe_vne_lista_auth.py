import os
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.routers.vne import (
    _VneHttpSession,
    _build_opener,
    _fetch_html,
    _maybe_login_vne,
    _cookie_jar_from_opener,
    _looks_like_login_page,
)

origin = "http://www.vneremote.com"
lista_url = f"{origin}/vne/lista/"
landing = f"{origin}/vne/"

opener, cj = _build_opener()
logged = _maybe_login_vne(opener, cj, origin=origin)
print("logged", logged, "sessionid", any(c.name == "sessionid" for c in cj))

html = _fetch_html(opener, lista_url, referer=landing)
print("login_page", _looks_like_login_page(html))
print("len", len(html))

for pat in [r"VIRTUO\d+", r"online|offline|on-?line|off-?line|conness|non conness", r"verde|rosso|green|red"]:
    ms = re.findall(pat, html, re.I)
    print(pat, ms[:12])

for m in re.finditer(r'href="(/vne/VIRTUO\d+/)"', html, re.I):
    print("href", m.group(1))

for m in re.finditer(r"<tr[^>]*>.*?</tr>", html, re.I | re.S):
    row = m.group(0)
    if re.search(r"virtuo|risacca|pasta|mucche|online|offline", row, re.I):
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", row)).strip()
        print("ROW", text[:260])

Path("scripts/lista_sample.html").write_text(html, encoding="utf-8")
print("saved scripts/lista_sample.html")
