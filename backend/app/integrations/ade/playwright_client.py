"""
Client Playwright per Agenzia delle Entrate — Fatture e Corrispettivi.

Flusso tipico (PC agenzia con chiavetta CNS):
  1. Avvia Chrome di sistema (channel=chrome) per usare il certificato smart card
  2. Apre portale IVA / Fatture e Corrispettivi
  3. Attende login CNS (PIN utente) o riusa storage_state salvato
  4. Va su Consultazione → Fatture ricevute → download XML/ZIP
  5. Cattura download + sweep cartella drop del profilo
  6. Logout / chiusura sessione

Finché le coordinate/portale non sono calibrate, ADE_XML_DROP_DIR / drop_dir
del profilo resta il percorso più affidabile (export manuale o semi-auto).
"""
from __future__ import annotations

import hashlib
import os
import re
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, List, Optional

from .profiles import AdeProfile


CHROME_UA = (
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
  "AppleWebKit/537.36 (KHTML, like Gecko) "
  "Chrome/144.0.0.0 Safari/537.36"
)

DEFAULT_PORTAL = "https://ivaservizi.agenziaentrate.gov.it/portale/"


@dataclass
class DownloadedXml:
  filename: str
  data: bytes
  sha256: str
  source: str = "download"
  profile_id: str = ""
  sede: str = ""


@dataclass
class AdeSyncResult:
  ok: bool
  message: str
  downloaded: List[DownloadedXml] = field(default_factory=list)
  screenshots: List[str] = field(default_factory=list)
  login_ok: bool = False
  profile_id: str = ""
  sede: str = ""


def _env(name: str, default: str = "") -> str:
  return (os.getenv(name, default) or default).strip()


def _env_int(name: str, default: int) -> int:
  raw = _env(name, str(default))
  try:
    return int(raw)
  except ValueError:
    return default


def _env_bool(name: str, default: bool = False) -> bool:
  raw = _env(name, "1" if default else "0").lower()
  return raw in ("1", "true", "yes", "on")


def _looks_like_fatturapa(data: bytes) -> bool:
  if not data or len(data) < 40:
    return False
  head = data[:4000].decode("utf-8", errors="ignore")
  low = head.lower()
  return (
    "fatturaelettronica" in low.replace(" ", "")
    or "p:fatturaelettronica" in low
    or ("fattura" in low and "body" in low and "cessionario" in low)
    or ("<?xml" in low and "fattura" in low)
  )


def _extract_xmls_from_bytes(data: bytes, filename: str) -> List[tuple[str, bytes]]:
  """XML singolo o ZIP con uno/più XML."""
  out: List[tuple[str, bytes]] = []
  if data[:2] == b"PK":
    try:
      with zipfile.ZipFile(BytesIO(data)) as zf:
        for info in zf.infolist():
          if info.is_dir():
            continue
          name = info.filename
          if not name.lower().endswith((".xml", ".p7m")):
            continue
          raw = zf.read(info)
          # .p7m spesso è XML enveloped — passa comunque se sembra xml
          if _looks_like_fatturapa(raw) or name.lower().endswith(".xml"):
            base = Path(name).name
            out.append((base, raw))
    except Exception:
      pass
    return out
  if _looks_like_fatturapa(data) or filename.lower().endswith((".xml", ".p7m")):
    out.append((filename or "fattura.xml", data))
  return out


class AdePlaywrightClient:
  """Sessione AdE per un profilo (una società / sede)."""

  def __init__(self, profile: AdeProfile) -> None:
    self.profile = profile
    self.portal_url = _env("ADE_PORTAL_URL", DEFAULT_PORTAL)
    self.lookback_days = _env_int("ADE_LOOKBACK_DAYS", 60)
    # CNS: meglio headed + Chrome di sistema
    self.headless = _env_bool("ADE_HEADLESS", False)
    self.use_system_chrome = _env_bool("ADE_USE_SYSTEM_CHROME", True)
    self.cns_pin_wait_sec = _env_int("ADE_CNS_PIN_WAIT_SEC", 180)
    self.login_timeout_sec = _env_int("ADE_LOGIN_TIMEOUT_SEC", 300)

    debug_raw = _env("ADE_DEBUG_DIR")
    if debug_raw:
      debug = Path(debug_raw)
    else:
      debug = Path(__file__).resolve().parents[2] / "uploads" / "ade_debug"
    self.debug_dir = Path(debug) / profile.id
    self.debug_dir.mkdir(parents=True, exist_ok=True)
    self._download_dir = self.debug_dir / "downloads"
    self._download_dir.mkdir(parents=True, exist_ok=True)

    self._xml_captures: List[DownloadedXml] = []

  def _shot(self, page: Any, name: str, shots: List[str]) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = self.debug_dir / f"{ts}_{name}.png"
    try:
      page.screenshot(path=str(path), full_page=True)
      shots.append(str(path))
    except Exception:
      pass

  def _remember(self, data: bytes, filename: str, source: str) -> None:
    for fname, raw in _extract_xmls_from_bytes(data, filename):
      if not raw or len(raw) < 40:
        continue
      sha = hashlib.sha256(raw).hexdigest()
      if any(x.sha256 == sha for x in self._xml_captures):
        continue
      self._xml_captures.append(
        DownloadedXml(
          filename=fname,
          data=raw,
          sha256=sha,
          source=source,
          profile_id=self.profile.id,
          sede=self.profile.sede,
        )
      )
      # salva copia debug
      try:
        safe = re.sub(r"[^\w.\-]+", "_", fname)[:180]
        (self._download_dir / f"{sha[:12]}_{safe}").write_bytes(raw)
      except Exception:
        pass

  def _attach_download_handler(self, page: Any) -> None:
    def on_download(download: Any) -> None:
      try:
        suggested = download.suggested_filename or "ade_download.bin"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        self._remember(target.read_bytes(), suggested, "browser_download")
      except Exception:
        pass

    page.on("download", on_download)

  def _attach_network_sniffer(self, page: Any) -> None:
    def on_response(resp: Any) -> None:
      try:
        url = (resp.url or "").lower()
        ctype = (resp.headers.get("content-type") or "").lower()
        if not any(
          x in url or x in ctype
          for x in ("xml", "zip", "octet-stream", "download", "fattur")
        ):
          return
        if resp.status != 200:
          return
        body = resp.body()
        if not body:
          return
        name = url.split("?")[0].rstrip("/").split("/")[-1] or "network.xml"
        if body[:2] == b"PK" or _looks_like_fatturapa(body) or "xml" in ctype:
          self._remember(body, name, "network")
      except Exception:
        pass

    page.on("response", on_response)

  def _sweep_drop_dir(self) -> None:
    dirs: List[Path] = []
    if self.profile.drop_dir:
      dirs.append(Path(self.profile.drop_dir))
    global_drop = _env("ADE_XML_DROP_DIR")
    if global_drop:
      dirs.append(Path(global_drop) / self.profile.id)
      dirs.append(Path(global_drop))
    # anche downloads locali
    dirs.append(self._download_dir)

    seen: set[str] = set()
    for root in dirs:
      if not root.is_dir():
        continue
      key = str(root.resolve())
      if key in seen:
        continue
      seen.add(key)
      for p in root.rglob("*"):
        if not p.is_file():
          continue
        if p.suffix.lower() not in (".xml", ".zip", ".p7m"):
          continue
        try:
          age_days = (time.time() - p.stat().st_mtime) / 86400.0
          if age_days > self.lookback_days:
            continue
          self._remember(p.read_bytes(), p.name, f"drop:{root.name}")
        except Exception:
          continue

  def _storage_path(self) -> Optional[Path]:
    raw = self.profile.storage_state_path or _env(
      f"ADE_STORAGE_STATE_{self.profile.id.upper()}", ""
    )
    if not raw:
      raw = str(self.debug_dir / "storage_state.json")
    return Path(raw)

  def _wait_logged_in(self, page: Any, shots: List[str]) -> bool:
    """Attende area autenticata dopo CNS/SPID/CIE."""
    deadline = time.time() + max(60, self.login_timeout_sec)
    pin_deadline = time.time() + max(30, self.cns_pin_wait_sec)

    # Se siamo sulla pagina scelta CNS, clicca «Entra con CNS»
    try:
      if page.get_by_role("button", name=re.compile(r"Entra con CNS", re.I)).count() > 0:
        self._shot(page, "01b_cns_choice", shots)
        page.get_by_role("button", name=re.compile(r"Entra con CNS", re.I)).first.click(timeout=8000)
        page.wait_for_timeout(2000)
      elif page.get_by_text(re.compile(r"Entra con CNS", re.I)).count() > 0:
        page.get_by_text(re.compile(r"Entra con CNS", re.I)).first.click(timeout=8000)
        page.wait_for_timeout(2000)
    except Exception:
      pass

    while time.time() < deadline:
      url = (page.url or "").lower()
      title = (page.title() or "").lower()
      try:
        body = page.inner_text("body")[:2000].lower()
      except Exception:
        body = ""

      # Errori CNS evidenti
      if "errore durante l'accesso con cns" in body or "errore durante l'accesso con cns" in body.replace(
        "’", "'"
      ):
        self._shot(page, "01_cns_error", shots)
        return False
      if "cns potrebbe non essere inserita" in body or "cns non viene letta" in body:
        self._shot(page, "01_cns_not_read", shots)
        return False

      # Ancora su scelta credenziale / PIN / login
      still_login = any(
        s in body or s in title or s in url
        for s in (
          "accedi all'area riservata",
          "accedi all’area riservata",
          "entra con cns",
          "inserisci il pin",
          "carta nazionale",
          "smart card",
          "seleziona il certificato",
          "scegli una delle modalità",
          "fisconline",
          "entratel",
        )
      )
      if still_login:
        if time.time() > pin_deadline:
          self._shot(page, "01_cns_pin_timeout", shots)
          return False
        # Riprova click CNS se ancora visibile
        try:
          btn = page.get_by_role("button", name=re.compile(r"Entra con CNS", re.I))
          if btn.count() > 0:
            btn.first.click(timeout=3000)
        except Exception:
          pass
        page.wait_for_timeout(2000)
        continue

      logged = any(
        s in body or s in url or s in title
        for s in (
          "fatture e corrispettivi",
          "cassetto fiscale",
          "consultazione fatture",
          "scelta servizi",
          "la mia area",
          "disconnetti",
        )
      )
      # Escludi landing pubblica
      if logged and "entra con cns" not in body and "accedi all" not in body[:120]:
        self._shot(page, "02_logged_in", shots)
        return True

      page.wait_for_timeout(1500)

    self._shot(page, "01_login_timeout", shots)
    return False

  def _navigate_fatture_ricevute(self, page: Any, shots: List[str]) -> bool:
    """Best-effort verso consultazione fatture ricevute."""
    # Link / testi tipici del portale
    candidates = [
      "Fatture e corrispettivi",
      "Fatture elettroniche",
      "Consultazione",
      "Fatture ricevute",
      "Ricevute",
    ]
    for label in candidates:
      try:
        loc = page.get_by_role("link", name=re.compile(label, re.I)).first
        if loc.count() > 0:
          loc.click(timeout=5000)
          page.wait_for_timeout(1500)
          continue
      except Exception:
        pass
      try:
        loc = page.get_by_text(re.compile(f"^{re.escape(label)}$", re.I)).first
        loc.click(timeout=4000)
        page.wait_for_timeout(1500)
      except Exception:
        continue

    # URL diretti noti (possono cambiare; override con ADE_FATTURE_RICEVUTE_URL)
    direct = _env("ADE_FATTURE_RICEVUTE_URL")
    if direct:
      try:
        page.goto(direct, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2000)
      except Exception:
        pass

    self._shot(page, "03_fatture_ricevute_nav", shots)
    return True

  def _try_download_xml(self, page: Any, shots: List[str]) -> None:
    before = len(self._xml_captures)
    # Pulsanti tipici
    for name in (
      "Scarica",
      "Download",
      "Esporta",
      "Scarica XML",
      "Scarica file",
      "ZIP",
    ):
      try:
        with page.expect_download(timeout=4000) as dl_info:
          page.get_by_role("button", name=re.compile(name, re.I)).first.click(timeout=3000)
        download = dl_info.value
        suggested = download.suggested_filename or "ade.xml"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        self._remember(target.read_bytes(), suggested, f"btn:{name}")
      except Exception:
        try:
          page.get_by_text(re.compile(name, re.I)).first.click(timeout=2000)
          page.wait_for_timeout(1000)
        except Exception:
          pass

    # Checkbox seleziona tutto + scarica (coordinate override)
    sx, sy = _env("ADE_CLICK_SELECT_ALL_X"), _env("ADE_CLICK_SELECT_ALL_Y")
    dx, dy = _env("ADE_CLICK_DOWNLOAD_X"), _env("ADE_CLICK_DOWNLOAD_Y")
    if sx and sy:
      try:
        page.mouse.click(int(sx), int(sy))
        page.wait_for_timeout(400)
      except Exception:
        pass
    if dx and dy:
      try:
        with page.expect_download(timeout=15000) as dl_info:
          page.mouse.click(int(dx), int(dy))
        download = dl_info.value
        suggested = download.suggested_filename or "ade_sel.xml"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        self._remember(target.read_bytes(), suggested, "click_download")
      except Exception:
        self._shot(page, "04_download_click_fail", shots)

    page.wait_for_timeout(2000)
    self._sweep_drop_dir()
    self._shot(page, "04_after_download", shots)
    if len(self._xml_captures) == before:
      page.wait_for_timeout(3000)
      self._sweep_drop_dir()

  def _logout(self, page: Any, shots: List[str]) -> None:
    try:
      self._shot(page, "90_before_logout", shots)
    except Exception:
      pass
    for label in ("Esci", "Logout", "Disconnetti", "Chiudi sessione"):
      try:
        page.get_by_role("link", name=re.compile(label, re.I)).first.click(timeout=3000)
        page.wait_for_timeout(800)
        break
      except Exception:
        try:
          page.get_by_text(re.compile(label, re.I)).first.click(timeout=2000)
          page.wait_for_timeout(800)
          break
        except Exception:
          continue
    try:
      page.goto(self.portal_url, wait_until="domcontentloaded", timeout=20000)
    except Exception:
      pass
    try:
      self._shot(page, "91_after_logout", shots)
    except Exception:
      pass

  def run_download(self) -> AdeSyncResult:
    self._xml_captures = []
    shots: List[str] = []

    # Modalità solo drop: niente browser
    if (self.profile.auth_mode or "").lower() == "drop":
      self._sweep_drop_dir()
      msg = (
        f"[{self.profile.id}] drop-only; XML={len(self._xml_captures)} "
        f"sede={self.profile.sede}"
      )
      return AdeSyncResult(
        ok=bool(self._xml_captures),
        message=msg,
        downloaded=list(self._xml_captures),
        screenshots=shots,
        login_ok=True,
        profile_id=self.profile.id,
        sede=self.profile.sede,
      )

    try:
      from playwright.sync_api import sync_playwright
    except ImportError:
      # Fallback: prova comunque la drop dir
      self._sweep_drop_dir()
      return AdeSyncResult(
        ok=bool(self._xml_captures),
        message=(
          f"[{self.profile.id}] playwright non installato; "
          f"usata solo drop_dir (XML={len(self._xml_captures)}). "
          "pip install -r requirements-ade-agent.txt && playwright install chrome"
        ),
        downloaded=list(self._xml_captures),
        screenshots=shots,
        login_ok=False,
        profile_id=self.profile.id,
        sede=self.profile.sede,
      )

    login_ok = False
    result: Optional[AdeSyncResult] = None
    storage = self._storage_path()

    with sync_playwright() as p:
      launch_kwargs: dict = {
        "headless": self.headless,
        "args": ["--disable-dev-shm-usage"],
      }
      # Chrome di sistema: legge certificati / smart card Windows
      if self.use_system_chrome:
        try:
          browser = p.chromium.launch(channel="chrome", **launch_kwargs)
        except Exception:
          browser = p.chromium.launch(**launch_kwargs)
      else:
        browser = p.chromium.launch(**launch_kwargs)

      ctx_kwargs: dict = {
        "user_agent": CHROME_UA,
        "locale": "it-IT",
        "accept_downloads": True,
        "viewport": {"width": 1360, "height": 900},
      }
      if storage and storage.is_file() and (self.profile.auth_mode or "") in (
        "cns",
        "storage",
      ):
        try:
          ctx_kwargs["storage_state"] = str(storage)
        except Exception:
          pass

      context = browser.new_context(**ctx_kwargs)
      page = context.new_page()
      self._attach_network_sniffer(page)
      self._attach_download_handler(page)

      try:
        page.goto(self.portal_url, wait_until="domcontentloaded", timeout=90000)
        self._shot(page, "01_portal", shots)

        # Se auth_mode=cns e non c'è sessione, l'utente inserisce PIN sulla dialog OS
        login_ok = self._wait_logged_in(page, shots)
        if not login_ok:
          # prova comunque sweep drop
          self._sweep_drop_dir()
          result = AdeSyncResult(
            ok=bool(self._xml_captures),
            message=(
              f"[{self.profile.id}] login AdE non completato "
              f"(CNS/PIN o sessione). XML drop={len(self._xml_captures)}. "
              f"Apri con ADE_HEADLESS=0 e inserisci PIN entro ADE_CNS_PIN_WAIT_SEC."
            ),
            downloaded=list(self._xml_captures),
            screenshots=shots,
            login_ok=False,
            profile_id=self.profile.id,
            sede=self.profile.sede,
          )
        else:
          # Salva sessione per run successivi (meno PIN)
          if storage:
            try:
              storage.parent.mkdir(parents=True, exist_ok=True)
              context.storage_state(path=str(storage))
            except Exception:
              pass

          self._navigate_fatture_ricevute(page, shots)
          self._try_download_xml(page, shots)
          self._sweep_drop_dir()

          msg = (
            f"[{self.profile.id}] login OK; sede={self.profile.sede}; "
            f"XML={len(self._xml_captures)}"
          )
          if not self._xml_captures:
            msg += (
              ". Nessun XML: calibra ADE_CLICK_* / ADE_FATTURE_RICEVUTE_URL "
              f"oppure esporta in drop_dir={self.profile.drop_dir or _env('ADE_XML_DROP_DIR')}"
            )
          result = AdeSyncResult(
            ok=bool(self._xml_captures),
            message=msg,
            downloaded=list(self._xml_captures),
            screenshots=shots,
            login_ok=True,
            profile_id=self.profile.id,
            sede=self.profile.sede,
          )
      except Exception as e:
        self._shot(page, "99_exception", shots)
        self._sweep_drop_dir()
        result = AdeSyncResult(
          ok=bool(self._xml_captures),
          message=f"[{self.profile.id}] errore AdE: {e}",
          downloaded=list(self._xml_captures),
          screenshots=shots,
          login_ok=login_ok,
          profile_id=self.profile.id,
          sede=self.profile.sede,
        )
      finally:
        try:
          self._logout(page, shots)
        except Exception:
          pass
        try:
          context.close()
        except Exception:
          pass
        try:
          browser.close()
        except Exception:
          pass

    if result is None:
      result = AdeSyncResult(
        ok=False,
        message=f"[{self.profile.id}] sessione interrotta",
        screenshots=shots,
        profile_id=self.profile.id,
        sede=self.profile.sede,
      )
    result.screenshots = shots
    if "logout" not in result.message.lower():
      result.message = f"{result.message} | logout eseguito"
    return result
