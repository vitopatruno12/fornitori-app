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
from datetime import datetime, timedelta, timezone
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
DEFAULT_AREA_RISERVATA_URL = "https://www.agenziaentrate.gov.it/portale/area-riservata"
DEFAULT_MASS_WEB_FATTURE_URL = (
  "https://ivaservizi.agenziaentrate.gov.it/cons/mass-web/#/richieste/fatture"
)


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


def _is_ade_mass_request_xml(data: bytes) -> bool:
  """XML InputMassivo AdE (richiesta), non FatturaPA."""
  low = data[:4000].decode("utf-8", errors="ignore").lower()
  return "inputmassivo" in low or "tiporichiesta" in low


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
          if _is_ade_mass_request_xml(raw):
            continue
          # .p7m = FatturaPA firmata (binario CMS): includi sempre dal ZIP
          low_name = name.lower()
          if low_name.endswith((".xml", ".p7m")) or _looks_like_fatturapa(raw):
            base = Path(name).name
            out.append((base, raw))
    except Exception:
      pass
    return out
  if _is_ade_mass_request_xml(data):
    return out
  low_name = (filename or "").lower()
  if _looks_like_fatturapa(data) or low_name.endswith((".xml", ".p7m")):
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
    auth = (profile.auth_mode or "cns").lower()
    self.fast_login = _env_bool("ADE_FAST_LOGIN", auth == "fisconline")
    self.step_delay_ms = _env_int("ADE_STEP_DELAY_MS", 200 if self.fast_login else 800)
    self.debug_screenshots = _env_bool("ADE_DEBUG_SCREENSHOTS", not self.fast_login)
    self.login_url = (
      _env("ADE_LOGIN_URL")
      or "https://iampe.agenziaentrate.gov.it/sam/UI/Login?realm=/agenziaentrate"
    )

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

    self._active_page: Any = None

  def _pause(self, page: Any, ms: Optional[int] = None) -> None:
    try:
      page.wait_for_timeout(ms if ms is not None else self.step_delay_ms)
    except Exception:
      pass

  def _shot(self, page: Any, name: str, shots: List[str], *, force: bool = False) -> None:
    if not self.debug_screenshots and not force:
      if not any(x in name for x in ("error", "bad", "timeout", "exception", "missing", "fail")):
        return
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

  def _dismiss_ade_modals(self, page: Any) -> None:
    """Chiude popup AdE (precompilata, ricevute, cookie, banner)."""
    for _ in range(2):
      try:
        page.keyboard.press("Escape")
        self._pause(page, 80)
      except Exception:
        pass

    body = ""
    try:
      body = self._page_text(page, 900).lower()
    except Exception:
      pass

    if "precompilat" in body or "dichiarazione" in body:
      for label in (
        r"Chiudi",
        r"Non ora",
        r"Non adesso",
        r"Ho capito",
        r"^OK$",
        r"^Ok$",
        r"Ignora",
        r"Annulla",
        r"Continua",
      ):
        try:
          page.get_by_role("button", name=re.compile(label, re.I)).first.click(timeout=1200)
          self._pause(page, 150)
          return
        except Exception:
          try:
            page.get_by_text(re.compile(label, re.I)).first.click(timeout=1000)
            self._pause(page, 150)
            return
          except Exception:
            continue

    for label in (
      r"Chiudi",
      r"Close",
      r"×",
      r"Non ora",
      r"Ho capito",
      r"^OK$",
      r"Ignora",
    ):
      try:
        btn = page.get_by_role("button", name=re.compile(label, re.I))
        if btn.count() > 0:
          btn.first.click(timeout=1200)
          self._pause(page, 120)
          return
      except Exception:
        pass
      try:
        page.get_by_text(re.compile(f"^{label}$", re.I)).first.click(timeout=900)
        self._pause(page, 120)
        return
      except Exception:
        continue

    for sel in (
      'button[aria-label*="Chiudi"]',
      'button[aria-label*="chiudi"]',
      'button[aria-label*="Close"]',
      '[class*="close"]',
      ".modal button",
      ".dialog button",
    ):
      try:
        loc = page.locator(sel)
        if loc.count() > 0:
          loc.first.click(timeout=900)
          self._pause(page, 120)
          return
      except Exception:
        continue

  def _open_login_page(self, page: Any, shots: List[str]) -> None:
    """Apre direttamente la pagina login Fisconline (salta landing portale)."""
    login_urls = [self.login_url, _env("ADE_LOGIN_URL"), self.portal_url]
    seen: set[str] = set()
    for url in login_urls:
      if not url or url in seen:
        continue
      seen.add(url)
      try:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        self._pause(page, 300 if self.fast_login else 1200)
        self._dismiss_ade_modals(page)
        body = self._page_text(page, 800).lower()
        if any(s in body for s in ("codice fiscale", "password", "fisconline", "entratel")):
          self._shot(page, "01_login_direct", shots)
          return
      except Exception:
        continue

    if not self.fast_login:
      page.goto(self.portal_url, wait_until="domcontentloaded", timeout=90000)
      self._shot(page, "01_portal", shots)
      self._dismiss_ade_modals(page)
      for label in (
        r"Accedi all'area riservata",
        r"Accedi all’area riservata",
        r"Accedi all.area riservata",
      ):
        try:
          btn = page.get_by_role("link", name=re.compile(label, re.I))
          if btn.count() == 0:
            btn = page.get_by_role("button", name=re.compile(label, re.I))
          if btn.count() > 0:
            btn.first.click(timeout=5000)
            self._pause(page, 800)
            self._dismiss_ade_modals(page)
            self._shot(page, "01a_accedi_area", shots)
            return
        except Exception:
          try:
            page.get_by_text(re.compile(label, re.I)).first.click(timeout=4000)
            self._pause(page, 800)
            self._dismiss_ade_modals(page)
            self._shot(page, "01a_accedi_area", shots)
            return
          except Exception:
            continue

  def _page_text(self, page: Any, limit: int = 1200) -> str:
    try:
      return page.inner_text("body")[:limit]
    except Exception:
      return ""

  def _select_auth_tab(self, page: Any, mode: str) -> None:
    """Seleziona tab CNS o Fisconline/Entratel."""
    mode_l = (mode or "").lower()
    if mode_l == "fisconline":
      patterns = (r"Fisconline", r"Entratel", r"Fisconline/Entratel")
    else:
      patterns = (r"CNS",)
    for pat in patterns:
      try:
        tab = page.get_by_role("tab", name=re.compile(pat, re.I))
        if tab.count() > 0:
          tab.first.click(timeout=5000)
          page.wait_for_timeout(800)
          return
      except Exception:
        pass
      try:
        page.get_by_text(re.compile(f"^{pat}$", re.I)).first.click(timeout=3000)
        page.wait_for_timeout(800)
        return
      except Exception:
        continue

  def _login_fisconline(self, page: Any, shots: List[str]) -> bool:
    """
    Login Fisconline/Entratel (form web): CF + password + PIN — completamente automatico.
    Non usa la chiavetta CNS.
    """
    cf = (self.profile.codice_fiscale or self.profile.partita_iva or "").strip()
    password = (self.profile.fisconline_password or _env("ADE_FISCONLINE_PASSWORD")).strip()
    pin = (self.profile.fisconline_pin or _env("ADE_FISCONLINE_PIN")).strip()
    if not cf or not password or not pin:
      self._shot(page, "01_fisconline_missing_creds", shots)
      return False

    self._open_login_page(page, shots)
    self._select_auth_tab(page, "fisconline")
    self._pause(page, 250)
    self._shot(page, "01b_fisconline_tab", shots)

    def _fill_field(locators: list, value: str) -> bool:
      for loc in locators:
        try:
          if loc.count() == 0:
            continue
          el = loc.first
          el.click(timeout=4000)
          el.fill("")
          el.fill(value, timeout=5000)
          return True
        except Exception:
          continue
      return False

    filled_user = _fill_field(
      [
        page.get_by_label(re.compile(r"codice fiscale|nome utente", re.I)),
        page.locator('input[name="IDToken1"], input#username, input[name="username"]'),
      ],
      cf,
    )
    filled_pwd = _fill_field(
      [
        page.get_by_label(re.compile(r"password", re.I)),
        page.locator('input[name="IDToken2"]'),
      ],
      password,
    )
    filled_pin = _fill_field(
      [
        page.get_by_label(re.compile(r"^pin", re.I)),
        page.locator('input[name="IDToken3"], input[name="pin"], input#pin'),
      ],
      pin,
    )
    filled = filled_user and filled_pwd and filled_pin
    self._shot(page, "01b2_fisconline_filled", shots)

    if not filled:
      self._shot(page, "01_fisconline_form_not_found", shots)
      return False

    # Invio
    for btn_name in (r"Accedi", r"Entra", r"Login", r"Conferma"):
      try:
        page.get_by_role("button", name=re.compile(btn_name, re.I)).first.click(timeout=5000)
        break
      except Exception:
        try:
          page.get_by_text(re.compile(btn_name, re.I)).first.click(timeout=3000)
          break
        except Exception:
          continue
    else:
      page.keyboard.press("Enter")

    try:
      page.wait_for_load_state("domcontentloaded", timeout=15000)
    except Exception:
      pass
    self._pause(page, 600 if self.fast_login else 2500)
    self._shot(page, "01c_fisconline_submit", shots)
    return self._wait_logged_in(page, shots, skip_cns_click=True)

  def _login_cns(self, page: Any, shots: List[str]) -> bool:
    """Login CNS: richiede PIN sulla dialog Windows (non automatizzabile)."""
    self._open_login_page(page, shots)
    self._select_auth_tab(page, "cns")
    print(
      f"[{self.profile.id}] CNS: inserisci PIN nella finestra Windows se compare "
      "(non automatizzabile con chiavetta).",
      flush=True,
    )
    return self._wait_logged_in(page, shots)

  def _perform_login(self, page: Any, shots: List[str]) -> bool:
    mode = (self.profile.auth_mode or "cns").lower()
    if mode == "drop":
      return True
    if mode == "storage":
      # Prova sessione salvata; se scaduta usa fisconline se configurato
      if self._wait_logged_in(page, shots, skip_cns_click=True):
        return True
      if self.profile.fisconline_password and self.profile.fisconline_pin:
        return self._login_fisconline(page, shots)
      return self._login_cns(page, shots)
    if mode == "fisconline":
      return self._login_fisconline(page, shots)
    return self._login_cns(page, shots)

  def _wait_logged_in(self, page: Any, shots: List[str], *, skip_cns_click: bool = False) -> bool:
    """Attende area autenticata dopo CNS/SPID/CIE/Fisconline."""
    deadline = time.time() + max(60, self.login_timeout_sec)
    pin_deadline = time.time() + max(120, self.cns_pin_wait_sec)
    poll_ms = 350 if self.fast_login else 1200

    if not skip_cns_click:
      try:
        if page.get_by_role("button", name=re.compile(r"Entra con CNS", re.I)).count() > 0:
          self._shot(page, "01b_cns_choice", shots)
          page.get_by_role("button", name=re.compile(r"Entra con CNS", re.I)).first.click(timeout=5000)
          self._pause(page, 600)
        elif page.get_by_text(re.compile(r"Entra con CNS", re.I)).count() > 0:
          page.get_by_text(re.compile(r"Entra con CNS", re.I)).first.click(timeout=5000)
          self._pause(page, 600)
      except Exception:
        pass

    while time.time() < deadline:
      self._dismiss_ade_modals(page)
      url = (page.url or "").lower()
      title = (page.title() or "").lower()
      try:
        body = page.inner_text("body")[:2000].lower()
      except Exception:
        body = ""

      if "credenziali errate" in body or "autenticazione fallita" in body:
        self._shot(page, "01_bad_credentials", shots, force=True)
        return False

      if "errore durante l'accesso con cns" in body or "errore durante l'accesso con cns" in body.replace(
        "’", "'"
      ):
        self._shot(page, "01_cns_error", shots, force=True)
        return False
      if "cns potrebbe non essere inserita" in body or "cns non viene letta" in body:
        self._shot(page, "01_cns_not_read", shots, force=True)
        return False

      still_login = (
        "/login" in url
        or "iampe.agenziaentrate.gov.it" in url
        or any(
          s in body or s in title
          for s in (
            "accedi all'area riservata",
            "accedi all’area riservata",
            "entra con cns",
            "inserisci il pin",
            "carta nazionale",
            "smart card",
            "seleziona il certificato",
            "scegli una delle modalità",
          )
        )
      )
      if still_login:
        if time.time() > pin_deadline:
          self._shot(page, "01_cns_pin_timeout", shots, force=True)
          return False
        try:
          btn = page.get_by_role("button", name=re.compile(r"Entra con CNS", re.I))
          if btn.count() > 0:
            btn.first.click(timeout=2000)
        except Exception:
          pass
        self._pause(page, poll_ms)
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
          "il tuo profilo",
          "cerca il servizio",
          "cambia utenza",
          "richieste",
          "mass-web",
          "monitoraggio",
          "scelta profilo",
          "scelta utenza",
        )
      ) or "ivaservizi.agenziaentrate.gov.it" in url
      if logged and "entra con cns" not in body and "accedi all" not in body[:120]:
        self._post_login_cleanup(page)
        self._shot(page, "02_logged_in", shots)
        return True

      self._pause(page, poll_ms)

    self._shot(page, "01_login_timeout", shots, force=True)
    return False

  def _post_login_cleanup(self, page: Any) -> None:
    """Chiude popup post-login (ricevute non lette, precompilata, ecc.)."""
    loops = 2 if self.fast_login else 4
    for _ in range(loops):
      self._dismiss_ade_modals(page)
      try:
        body = self._page_text(page, 600).lower()
      except Exception:
        body = ""
      if "elenco ricevute non lette" in body:
        for label in (r"Chiudi", r"Home"):
          try:
            page.get_by_role("button", name=re.compile(label, re.I)).first.click(timeout=1500)
            self._pause(page, 200)
            break
          except Exception:
            try:
              page.get_by_role("link", name=re.compile(label, re.I)).first.click(timeout=1200)
              self._pause(page, 200)
              break
            except Exception:
              continue
      if "precompilat" in body:
        self._dismiss_ade_modals(page)
      self._pause(page, 120)

  def _use_fast_mass_web(self) -> bool:
    return (
      self.fast_login
      and self._utenza_mode() == "incaricato"
      and _env("ADE_USE_MASS_WEB", "1") not in ("0", "false", "no")
    )

  def _is_public_area_landing(self, page: Any) -> bool:
    """Landing pubblica «Accedi all'area riservata» (non autenticata)."""
    body = self._page_text(page, 1200).lower()
    if "torna all'area riservata" in body or "torna all’area riservata" in body:
      if "accedi all'area riservata" in body or "accedi all’area riservata" in body:
        return True
    if "registrazione per i professionisti" in body and "accedi all" in body:
      return True
    return False

  def _is_area_riservata_home(self, page: Any) -> bool:
    """Home autenticata (Cerca il servizio / utente connesso), non la landing pubblica."""
    if self._is_public_area_landing(page):
      return False
    body = self._page_text(page, 1200).lower()
    if "cerca il servizio" in body:
      return True
    if "utente connesso" in body and ("esci" in body or "cambia utenza" in body):
      return True
    if "ciao," in body and ("stai operando" in body or "utenza di lavoro" in body):
      return True
    return False

  def _ensure_logged_in_home(self, page: Any, shots: List[str]) -> Any:
    """Se siamo sulla landing pubblica, torna all'area riservata autenticata."""
    if self._is_area_riservata_home(page) or self._has_ivaservizi_session(page):
      return page
    if self._is_public_area_landing(page) or "area-riservata" in (page.url or "").lower():
      for label in (
        r"Torna all'area riservata",
        r"Torna all’area riservata",
        r"Torna all.area riservata",
      ):
        try:
          page.get_by_role("link", name=re.compile(label, re.I)).first.click(timeout=5000)
          self._pause(page, 800)
          break
        except Exception:
          try:
            page.get_by_role("button", name=re.compile(label, re.I)).first.click(timeout=4000)
            self._pause(page, 800)
            break
          except Exception:
            try:
              page.get_by_text(re.compile(label, re.I)).first.click(timeout=4000)
              self._pause(page, 800)
              break
            except Exception:
              continue
      self._wait_area_riservata_ready(page, timeout_ms=45000)
      self._shot(page, "03a_torna_area", shots)
    return page

  def _area_riservata_url(self) -> str:
    # Preferisci URL autenticato se configurato; evita la landing pubblica senza sessione
    return (
      _env("ADE_AREA_RISERVATA_URL")
      or _env("ADE_AREA_RISERVATA_HOME_URL")
      or DEFAULT_AREA_RISERVATA_URL
    )

  def _is_ade_login_page(self, page: Any) -> bool:
    try:
      body = self._page_text(page, 1000).lower()
    except Exception:
      body = ""
    url = (page.url or "").lower()
    if "accedi all" in body and any(s in body for s in ("spid", "fisconline", "entra con")):
      return True
    return "iampe.agenziaentrate.gov.it" in url and "/login" in url

  def _has_ivaservizi_session(self, page: Any) -> bool:
    if self._is_ade_login_page(page):
      return False
    url = (page.url or "").lower()
    if "ivaservizi.agenziaentrate.gov.it" not in url:
      return False
    body = self._page_text(page, 1500).lower()
    return any(
      s in body
      for s in (
        "fatture",
        "monitoraggio",
        "richieste",
        "utenza",
        "profilo",
        "corrispettivi",
        "denominazione",
      )
    )

  def _click_maybe_popup(self, page: Any, click: Any) -> Any:
    """Esegue click che può aprire popup o navigare nella stessa tab."""
    try:
      with page.expect_popup(timeout=12000) as popup_info:
        click()
      active = popup_info.value
      self._attach_network_sniffer(active)
      self._attach_download_handler(active)
      active.wait_for_load_state("domcontentloaded", timeout=30000)
      self._pause(active, 400)
      return active
    except Exception:
      click()
      self._pause(page, 500)
      return page

  def _wait_area_riservata_ready(self, page: Any, timeout_ms: int = 45000) -> bool:
    """Attende home autenticata con campo «Cerca il servizio» (non landing/utenza)."""
    deadline = time.time() + max(5, timeout_ms / 1000.0)
    while time.time() < deadline:
      self._post_login_cleanup(page)
      if self._is_area_utenza_page(page) or self._is_public_area_landing(page):
        self._pause(page, 400)
        continue
      try:
        search = page.get_by_placeholder(re.compile(r"cerca il servizio", re.I))
        if search.count() > 0 and search.first.is_visible():
          return True
      except Exception:
        pass
      if self._has_ivaservizi_session(page):
        return True
      self._pause(page, 500)
    return False

  def _enable_piva_search_toggle(self, page: Any) -> None:
    """Attiva 'Includi ... Partita IVA' se presente (servizi società)."""
    try:
      label = page.get_by_text(re.compile(r"partita\s*iva", re.I)).first
      # checkbox / switch vicino al testo
      for sel in (
        'input[type="checkbox"]',
        '[role="switch"]',
        'input[type="checkbox"] ~ label',
        "label",
      ):
        try:
          box = page.locator(sel).filter(has_text=re.compile(r"partita\s*iva", re.I))
          if box.count() > 0:
            box.first.click(timeout=2000)
            self._pause(page, 200)
            return
        except Exception:
          continue
      label.click(timeout=2000)
      self._pause(page, 200)
    except Exception:
      pass

  def _open_fatture_corrispettivi_sso(self, page: Any, shots: List[str]) -> Any:
    """Da area riservata autenticata: Cerca il servizio → Vai al servizio → Accedi."""
    active = self._ensure_logged_in_home(page, shots)
    if self._is_public_area_landing(active) or not self._is_area_riservata_home(active):
      self._shot(active, "03a_no_auth_home", shots, force=True)
      return active

    self._enable_piva_search_toggle(active)

    opened = False
    try:
      # Solo la search dei servizi autenticati (NON la search del sito pubblico)
      search = active.get_by_placeholder(re.compile(r"cerca il servizio", re.I))
      if search.count() == 0:
        self._shot(active, "03a_no_service_search", shots, force=True)
      else:
        search.first.click(timeout=4000)
        search.first.fill("Fatture e corrispettivi", timeout=4000)
        self._pause(active, 400)
        try:
          active.get_by_role("button", name=re.compile(r"^Cerca$", re.I)).first.click(timeout=4000)
        except Exception:
          active.keyboard.press("Enter")
        try:
          active.wait_for_function(
            "() => document.body && /vai al servizio/i.test(document.body.innerText)",
            timeout=25000,
          )
        except Exception:
          self._pause(active, 2000)
        self._shot(active, "03a_search_results", shots)

        # Click «Vai al servizio» (bottone spesso non actionable con locator strict)
        clicked = False
        try:
          ok = active.evaluate(
            """() => {
              const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"]'));
              const el = nodes.find(n => {
                const t = (n.innerText || n.textContent || n.value || '').replace(/\\s+/g, ' ').trim();
                if (!/vai al servizio/i.test(t)) return false;
                const r = n.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              });
              if (!el) return 'notfound';
              el.scrollIntoView({block: 'center', inline: 'center'});
              el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
              el.click();
              return (el.tagName + ':' + (el.innerText || '').replace(/\\s+/g,' ').trim()).slice(0, 80);
            }"""
          )
          print(f"[{self.profile.id}] Vai al servizio evaluate={ok}", flush=True)
          if ok and ok != "notfound":
            clicked = True
            opened = True
        except Exception as e:
          print(f"[{self.profile.id}] Vai evaluate fail: {e}", flush=True)

        if not clicked:
          try:
            loc = active.locator('button:has-text("Vai al servizio"), a:has-text("Vai al servizio")')
            n = loc.count()
            print(f"[{self.profile.id}] Vai locator count={n}", flush=True)
            for i in range(n):
              el = loc.nth(i)
              try:
                if not el.is_visible():
                  continue
                el.scroll_into_view_if_needed(timeout=5000)
                try:
                  with active.expect_popup(timeout=20000) as popup_info:
                    el.click(timeout=8000, force=True, no_wait_after=True)
                  active = popup_info.value
                  self._attach_network_sniffer(active)
                  self._attach_download_handler(active)
                except Exception:
                  el.click(timeout=8000, force=True)
                clicked = True
                opened = True
                break
              except Exception as e:
                print(f"[{self.profile.id}] Vai nth({i}) fail: {e}", flush=True)
          except Exception as e:
            print(f"[{self.profile.id}] Vai locator fail: {e}", flush=True)

        if opened:
          self._pause(active, 2000)
          try:
            pages = active.context.pages
            if len(pages) > 1 and pages[-1] != active:
              active = pages[-1]
              self._attach_network_sniffer(active)
              self._attach_download_handler(active)
          except Exception:
            pass
          try:
            active.wait_for_load_state("domcontentloaded", timeout=45000)
          except Exception:
            pass
          self._shot(active, "03a_dopo_vai_servizio", shots)
          print(f"[{self.profile.id}] dopo Vai url={getattr(active, 'url', '')}", flush=True)
    except Exception as e:
      print(f"[{self.profile.id}] open fatture search errore: {e}", flush=True)

    if not opened:
      # Fallback: menu Servizi nell'area autenticata
      try:
        active.get_by_role("link", name=re.compile(r"^Servizi$", re.I)).first.click(timeout=4000)
        self._pause(active, 800)
        link = active.get_by_text(re.compile(r"Fatture e corrispettivi", re.I))
        if link.count() > 0:
          active = self._click_maybe_popup(active, lambda: link.first.click(timeout=6000))
          opened = True
      except Exception:
        pass

    if opened or "fattur" in self._page_text(active, 800).lower() or "accessoFatturazione" in (active.url or ""):
      self._post_login_cleanup(active)
      self._pause(active, 800)
      # Accedi sulla card «Fatture e corrispettivi» (P.IVA), non «Le tue fatture»
      try:
        ok = active.evaluate(
          """() => {
            const cards = Array.from(document.querySelectorAll('div,section,article,li'));
            const card = cards.find(c => {
              const t = (c.innerText || '').replace(/\\s+/g,' ').trim();
              return /fatture e corrispettivi/i.test(t) && /\\baccedi\\b/i.test(t)
                && !/le tue fatture/i.test(t.slice(0,80))
                && t.length < 1200;
            });
            if (!card) {
              const btns = Array.from(document.querySelectorAll('a,button,[role=button]'));
              const b = btns.find(n => /^\\s*Accedi\\s*$/i.test((n.innerText||n.textContent||'').trim()));
              if (!b) return 'notfound';
              b.scrollIntoView({block:'center'});
              b.click();
              return 'fallback:' + b.tagName;
            }
            const btn = Array.from(card.querySelectorAll('a,button,[role=button]'))
              .find(n => /^\\s*Accedi\\s*$/i.test((n.innerText||n.textContent||'').trim()));
            if (!btn) return 'nocardbtn';
            btn.scrollIntoView({block:'center'});
            btn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
            btn.click();
            return 'ok:' + btn.tagName;
          }"""
        )
        print(f"[{self.profile.id}] Accedi Fatture evaluate={ok}", flush=True)
        if ok and ok not in ("notfound", "nocardbtn"):
          self._pause(active, 2500)
          try:
            pages = active.context.pages
            if len(pages) > 1:
              active = pages[-1]
              self._attach_network_sniffer(active)
              self._attach_download_handler(active)
          except Exception:
            pass
          try:
            active.wait_for_url(re.compile(r"ivaservizi|monitoraggio|mass-web", re.I), timeout=90000)
          except Exception:
            pass
          self._wait_iva_spa(active, need_text="fatture", timeout_ms=45000)
          self._shot(active, "03b_fatture_corrispettivi", shots)
          print(f"[{self.profile.id}] dopo Accedi url={getattr(active, 'url', '')}", flush=True)
      except Exception as e:
        print(f"[{self.profile.id}] Accedi fail: {e}", flush=True)

    return active

  def _bootstrap_ivaservizi_sso(self, page: Any, shots: List[str]) -> Any:
    """
    Area riservata → Fatture e corrispettivi (SSO) → utenza ivaservizi.
    Necessario prima della richiesta mass-web di scarico fatture.
    """
    active = page
    self._post_login_cleanup(active)
    active = self._ensure_logged_in_home(active, shots)
    active = self._complete_area_riservata_utenza(active, shots)
    active = self._ensure_logged_in_home(active, shots)

    if self._has_ivaservizi_session(active):
      active = self._complete_scelta_profilo_lavoro(active, shots)
      active = self._complete_utenza_lavoro(active, shots)
      self._shot(active, "03_sso_ready", shots)
      return active

    # NON andare sulla landing pubblica: se non siamo in home autenticata, clicca Torna
    if not self._is_area_riservata_home(active) and not self._has_ivaservizi_session(active):
      active = self._ensure_logged_in_home(active, shots)

    # Attendi home autenticata (Cerca il servizio)
    self._wait_area_riservata_ready(active, timeout_ms=60000)
    active = self._ensure_logged_in_home(active, shots)
    self._shot(active, "03a_area_ready", shots)

    if self._is_public_area_landing(active):
      self._shot(active, "03a_still_public", shots, force=True)
      return active

    if not self._has_ivaservizi_session(active):
      active = self._open_fatture_corrispettivi_sso(active, shots)

    active = self._complete_scelta_profilo_lavoro(active, shots)
    active = self._complete_utenza_lavoro(active, shots)
    self._shot(active, "03_sso_bootstrap", shots)
    self._active_page = active
    return active

  def _navigate_after_login(self, page: Any, shots: List[str]) -> Any:
    """Dopo login: SSO ivaservizi poi mass-web (rapido) o navigazione classica."""
    self._post_login_cleanup(page)
    if self._use_fast_mass_web():
      if not self._has_ivaservizi_session(page):
        page = self._bootstrap_ivaservizi_sso(page, shots)
      page = self._navigate_mass_web_fatture(page, shots)
      self._active_page = page
      return page
    return self._navigate_fatture_ricevute(page, shots)

  def _navigate_fatture_ricevute(self, page: Any, shots: List[str]) -> Any:
    """Best-effort verso consultazione fatture ricevute (portale IVA). Ritorna pagina attiva."""
    active = page
    self._post_login_cleanup(active)

    # Attendi caricamento home area riservata (spinner)
    try:
      active.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
      pass
    active.wait_for_timeout(2000)

    # Abilita servizi P.IVA nella ricerca (serve per fatture società)
    try:
      toggle = active.get_by_text(re.compile(r"servizi per i soggetti titolari di partita iva", re.I))
      if toggle.count() > 0:
        toggle.first.click(timeout=3000)
        active.wait_for_timeout(600)
    except Exception:
      pass

    # Ricerca servizio dall'area riservata → SSO verso ivaservizi
    opened = False
    try:
      search = active.get_by_placeholder(re.compile(r"cerca il servizio", re.I))
      if search.count() == 0:
        search = active.locator('input[type="search"], input[aria-label*="Cerca"]')
      if search.count() > 0:
        search.first.click(timeout=3000)
        search.first.fill("Fatture e corrispettivi", timeout=4000)
        active.wait_for_timeout(800)
        try:
          active.get_by_role("button", name=re.compile(r"^Cerca$", re.I)).first.click(timeout=4000)
          active.wait_for_timeout(2000)
        except Exception:
          active.keyboard.press("Enter")
          active.wait_for_timeout(2000)
        link = active.get_by_role("link", name=re.compile(r"Fatture e corrispettivi|Fatturazione elettronica", re.I))
        if link.count() == 0:
          link = active.get_by_text(re.compile(r"Fatture e corrispettivi|Fatturazione elettronica", re.I))
        # Risultato ricerca: bottone «Vai al servizio»
        try:
          vai = active.get_by_role("button", name=re.compile(r"Vai al servizio", re.I))
          if vai.count() == 0:
            vai = active.get_by_role("link", name=re.compile(r"Vai al servizio", re.I))
          if vai.count() > 0:
            try:
              with active.expect_popup(timeout=15000) as popup_info:
                vai.first.click(timeout=8000)
              active = popup_info.value
            except Exception:
              vai.first.click(timeout=8000)
            self._attach_network_sniffer(active)
            self._attach_download_handler(active)
            active.wait_for_load_state("domcontentloaded", timeout=30000)
            active.wait_for_timeout(2500)
            opened = True
        except Exception:
          pass
        if not opened and link.count() > 0:
          with active.expect_popup(timeout=15000) as popup_info:
            link.first.click(timeout=8000)
          active = popup_info.value
          self._attach_network_sniffer(active)
          self._attach_download_handler(active)
          active.wait_for_load_state("domcontentloaded", timeout=30000)
          active.wait_for_timeout(2500)
          opened = True
    except Exception:
      pass

    if not opened:
      try:
        vai = active.get_by_role("button", name=re.compile(r"Vai al servizio", re.I))
        if vai.count() == 0:
          vai = active.get_by_role("link", name=re.compile(r"Vai al servizio", re.I))
        if vai.count() > 0:
          try:
            with active.expect_popup(timeout=12000) as popup_info:
              vai.first.click(timeout=8000)
            active = popup_info.value
          except Exception:
            vai.first.click(timeout=8000)
          self._attach_network_sniffer(active)
          self._attach_download_handler(active)
          active.wait_for_timeout(3000)
          opened = True
      except Exception:
        pass

    if not opened:
      try:
        link = active.get_by_role("link", name=re.compile(r"Fatturazione elettronica|Fatture e corrispettivi", re.I)).first
        if link.count() > 0:
          link.click(timeout=8000)
          active.wait_for_timeout(3000)
          opened = True
      except Exception:
        pass

    if not opened:
      direct = _env("ADE_FATTURE_RICEVUTE_URL")
      if direct:
        try:
          active.goto(direct, wait_until="domcontentloaded", timeout=60000)
          active.wait_for_timeout(2500)
        except Exception:
          pass

    self._post_login_cleanup(active)

    # Landing «Fatturazione elettronica»: Accedi su card P.IVA (non «Le tue fatture»).
    # Non usare un ancestor comune alle due card: Accedi.first aprirebbe quella a sinistra.
    try:
      heading = active.get_by_text(re.compile(r"^Fatture e corrispettivi$", re.I)).first
      card = heading.locator(
        "xpath=ancestor::*[.//button[contains(normalize-space(.),'Accedi')] or "
        ".//a[contains(normalize-space(.),'Accedi')]][1]"
      )
      btn = card.get_by_role("button", name=re.compile(r"^Accedi$", re.I))
      if btn.count() == 0:
        btn = card.get_by_role("link", name=re.compile(r"^Accedi$", re.I))
      if btn.count() > 0:
        try:
          with active.expect_popup(timeout=20000) as popup_info:
            btn.first.click(timeout=8000)
          active = popup_info.value
        except Exception:
          btn.first.click(timeout=8000)
        self._attach_network_sniffer(active)
        self._attach_download_handler(active)
        active.wait_for_load_state("domcontentloaded", timeout=60000)
        active.wait_for_timeout(3500)
        self._wait_iva_spa(active, need_text="monitoraggio", timeout_ms=50000)
        self._shot(active, "03b_fatture_corrispettivi", shots)
    except Exception:
      pass

    for label in (
      "Fatture e corrispettivi",
      "Fatturazione elettronica",
      "Consultazione",
      "Fatture ricevute",
      "Fatture elettroniche",
    ):
      try:
        loc = active.get_by_role("link", name=re.compile(label, re.I))
        if loc.count() > 0:
          loc.first.click(timeout=5000)
          active.wait_for_timeout(1500)
      except Exception:
        try:
          active.get_by_text(re.compile(f"^{re.escape(label)}$", re.I)).first.click(timeout=4000)
          active.wait_for_timeout(1500)
        except Exception:
          continue

    self._shot(active, "03_fatture_ricevute_nav", shots)
    self._active_page = active
    return active

  def _utenza_mode(self) -> str:
    mode = (self.profile.utenza_mode or _env(f"ADE_PROFILE_{self.profile.id.upper()}_UTENZA_MODE") or "auto").lower()
    if mode in ("incaricato", "me_stesso"):
      return mode
    return "incaricato" if (self.profile.partita_iva or "").strip() else "me_stesso"

  def _piva_digits(self) -> str:
    return re.sub(r"\D", "", self.profile.partita_iva or "")

  def _is_placeholder_option(self, text: str) -> bool:
    low = (text or "").strip().lower()
    return not low or "seleziona" in low or low in ("--", "-", "…")

  def _incaricante_needles(self) -> list[str]:
    needles: list[str] = []
    for raw in (
      self.profile.partita_iva,
      self._piva_digits(),
      self.profile.label,
      self.profile.id.replace("_", " "),
    ):
      val = (raw or "").strip()
      if val and val not in needles:
        needles.append(val)
    # Alias utili
    pid = (self.profile.id or "").lower()
    if pid == "mediazione":
      for a in ("MEDIAZIONE", "LA MEDIAZIONE"):
        if a not in needles:
          needles.append(a)
    if pid == "via_lattea":
      for a in ("VIA LATTEA", "LA VIA LATTEA"):
        if a not in needles:
          needles.append(a)
    return needles

  def _select_incaricante(self, page: Any) -> bool:
    """Menu CF/P.IVA / Scegli incaricante: conferma la voce proposta o la prima valida."""
    profile_needles = self._incaricante_needles()

    def _pick_option_index(opts: Any) -> int:
      """Preferisce opzione già selezionata, altrimenti la prima voce proposta."""
      first_valid = -1
      for j in range(opts.count()):
        text = (opts.nth(j).inner_text() or "").strip()
        if self._is_placeholder_option(text):
          continue
        if first_valid < 0:
          first_valid = j
        try:
          if opts.nth(j).is_selected():
            return j
        except Exception:
          pass
        low = text.lower()
        if any(n and n.lower() in low for n in profile_needles):
          return j
      return first_valid

    # Select HTML nativo (tipico AdE)
    try:
      selects = page.locator("select")
      for i in range(selects.count()):
        sel = selects.nth(i)
        opts = sel.locator("option")
        idx = _pick_option_index(opts)
        if idx < 0:
          continue
        try:
          sel.click(timeout=4000)
          page.wait_for_timeout(800)
        except Exception:
          pass
        try:
          if opts.nth(idx).is_selected():
            return True
        except Exception:
          pass
        sel.select_option(index=idx)
        page.wait_for_timeout(800)
        return True
    except Exception:
      pass

    label_re = re.compile(r"codice fiscale|partita\s*iva|^scegli", re.I)
    opened = False
    for opener in (
      lambda: page.get_by_label(label_re),
      lambda: page.get_by_role("combobox"),
      lambda: page.locator("text=/^Scegli\\s*:?/i").locator("xpath=following::*[self::select or self::button or @role='combobox' or contains(@class,'select')][1]"),
      lambda: page.locator("[role='listbox'], .select, .dropdown, .ui-select, mat-select, ng-select").first,
    ):
      try:
        loc = opener()
        if hasattr(loc, "count") and loc.count() == 0:
          continue
        loc.first.click(timeout=5000)
        page.wait_for_timeout(1200)
        opened = True
        break
      except Exception:
        continue

    if not opened:
      try:
        page.get_by_text(re.compile(r"^Scegli", re.I)).first.click(timeout=3000)
        page.wait_for_timeout(1000)
        opened = True
      except Exception:
        pass

    if opened:
      # Preferisci match P.IVA / denominazione profilo, altrimenti prima voce valida
      for needle in profile_needles:
        if not needle:
          continue
        pat = re.compile(re.escape(str(needle).strip()), re.I)
        for pick in (
          lambda p=pat: page.get_by_role("option", name=p),
          lambda p=pat: page.locator("[role='option']").filter(has_text=p),
          lambda p=pat: page.locator("li, .dropdown-item, .select-option, mat-option").filter(has_text=p),
        ):
          try:
            loc = pick()
            if loc.count() > 0:
              loc.first.click(timeout=5000)
              page.wait_for_timeout(800)
              return True
          except Exception:
            continue

      for pick in (
        lambda: page.get_by_role("option"),
        lambda: page.locator("[role='option']"),
        lambda: page.locator("li, .dropdown-item, .select-option, mat-option"),
      ):
        try:
          opts = pick()
          for j in range(min(opts.count(), 12)):
            text = (opts.nth(j).inner_text() or "").strip()
            if self._is_placeholder_option(text):
              continue
            opts.nth(j).click(timeout=5000)
            page.wait_for_timeout(800)
            return True
        except Exception:
          continue

    return False

  def _is_area_utenza_page(self, page: Any) -> bool:
    url = (page.url or "").lower()
    # Wizard ivaservizi e un altro flusso (Incaricato/Me stesso + Procedi)
    if "ivaservizi" in url or "instradamento" in url or "instr/" in url:
      return False
    body = self._page_text(page, 1500).lower()
    if "configura l'utenza" in body and "me stesso" in body:
      return False
    return any(
      s in body
      for s in (
        "selezione utenza di lavoro",
        "cambia utenza di lavoro",
        "opera come",
      )
    ) and ("incaricato" in body or "me stesso" in body or "scegli" in body)

  def _is_ivaservizi_utenza_wizard(self, page: Any) -> bool:
    body = self._page_text(page, 2000).lower()
    url = (page.url or "").lower()
    on_iva = "ivaservizi" in url or "instradamento" in url or "instr/" in url
    return on_iva and any(
      s in body
      for s in (
        "configura l'utenza",
        "scegli utenza di lavoro",
        "me stesso",
      )
    ) and "incaricato" in body

  def _complete_area_riservata_utenza(self, page: Any, shots: List[str]) -> Any:
    """
    Area riservata «Cambia/Selezione utenza di lavoro»:
    Incaricato → menu Scegli (P.IVA/società) → Conferma → attende home.
    """
    piva = self._piva_digits()
    body = self._page_text(page, 1500).lower()
    body_digits = re.sub(r"\D", "", body)

    # Gia operiamo per la P.IVA richiesta
    if piva and piva in body_digits and (
      "stai operando" in body or "utenza di lavoro" in body or "la mediazione" in body
    ):
      if not self._is_area_utenza_page(page):
        return page

    if not self._is_area_utenza_page(page):
      if piva and piva not in body_digits and self._utenza_mode() == "incaricato":
        for label in (r"Cambia utenza di lavoro", r"Cambia Utenza", r"Cambia utenza"):
          try:
            page.get_by_role("link", name=re.compile(label, re.I)).first.click(timeout=4000)
            break
          except Exception:
            try:
              page.get_by_text(re.compile(label, re.I)).first.click(timeout=3000)
              break
            except Exception:
              continue
        # Attendi form selezione (prima usciva troppo presto)
        deadline = time.time() + 20
        while time.time() < deadline and not self._is_area_utenza_page(page):
          self._pause(page, 400)
      if not self._is_area_utenza_page(page):
        return page

    mode = self._utenza_mode()
    if mode == "incaricato":
      try:
        page.get_by_text(re.compile(r"^Incaricato$", re.I)).first.click(timeout=4000)
        self._pause(page, 400)
      except Exception:
        try:
          page.locator("label, div, span").filter(has_text=re.compile(r"^Incaricato$", re.I)).first.click(
            timeout=3000
          )
          self._pause(page, 400)
        except Exception:
          pass
    else:
      try:
        page.get_by_text(re.compile(r"Me stesso", re.I)).first.click(timeout=4000)
        self._pause(page, 300)
      except Exception:
        pass

    if mode == "incaricato":
      self._select_incaricante(page)
      self._shot(page, "03a_area_utenza_scelta", shots)

    for btn in (r"^Conferma$", r"Procedi", r"Continua"):
      try:
        page.get_by_role("button", name=re.compile(btn, re.I)).first.click(timeout=5000)
        break
      except Exception:
        try:
          page.get_by_text(re.compile(btn, re.I)).first.click(timeout=3000)
          break
        except Exception:
          continue

    # Attendi ritorno in home con utenza attiva + search
    deadline = time.time() + 45
    while time.time() < deadline:
      if self._is_area_utenza_page(page):
        self._pause(page, 400)
        continue
      body = self._page_text(page, 1200).lower()
      digits = re.sub(r"\D", "", body)
      try:
        search = page.get_by_placeholder(re.compile(r"cerca il servizio", re.I))
        has_search = search.count() > 0 and search.first.is_visible()
      except Exception:
        has_search = False
      if has_search and (not piva or piva in digits or "stai operando" in body):
        break
      self._pause(page, 500)

    self._shot(page, "03a_area_utenza_ok", shots)
    return page

  def _complete_scelta_profilo_lavoro(self, page: Any, shots: List[str]) -> Any:
    """
    Schermata «Scelta profilo/utenza di lavoro» (download massivo):
    scegli Incaricato/delegato → tabella P.IVA → SCARICA/RIPRENDI.
    """
    body = self._page_text(page, 2500).lower()
    if not any(
      s in body
      for s in (
        "scelta profilo di lavoro",
        "scelta utenza di lavoro",
        "per conto di soggetti",
        "per conto mio come persona fisica",
      )
    ):
      return page

    mode = self._utenza_mode()
    piva = self._piva_digits()

    if mode == "incaricato":
      for pat in (
        r"incaricato o delegato",
        r"incaricato.*delegato",
        r"per conto di soggetti di cui sono incaricato",
      ):
        try:
          page.get_by_text(re.compile(pat, re.I)).first.click(timeout=6000)
          page.wait_for_timeout(1000)
          break
        except Exception:
          continue
    else:
      try:
        page.get_by_text(re.compile(r"persona fisica", re.I)).first.click(timeout=5000)
        page.wait_for_timeout(800)
      except Exception:
        pass

    self._wait_iva_spa(page, need_text="denominazione", timeout_ms=30000)

    if piva:
      try:
        row = page.locator("tr").filter(has_text=re.compile(piva))
        if row.count() > 0:
          cb = row.first.locator('input[type="checkbox"]')
          if cb.count() > 0:
            cb.first.check(timeout=4000)
          else:
            row.first.click(timeout=4000)
          page.wait_for_timeout(800)
      except Exception:
        pass
      self._select_incaricante(page)

    for btn in (r"^SCARICA$", r"^RIPRENDI$", r"Procedi", r"Continua", r"Conferma"):
      try:
        page.get_by_role("button", name=re.compile(btn, re.I)).first.click(timeout=6000)
        page.wait_for_timeout(2500)
        break
      except Exception:
        try:
          page.get_by_text(re.compile(btn, re.I)).first.click(timeout=4000)
          page.wait_for_timeout(2500)
          break
        except Exception:
          continue

    self._shot(page, "03d0_scelta_profilo", shots)
    return page

  def _navigate_mass_web_fatture(self, page: Any, shots: List[str]) -> Any:
    """Portale download massivo fatture (cons/mass-web). Richiede sessione SSO ivaservizi."""
    mass_url = _env("ADE_FATTURE_RICEVUTE_URL") or DEFAULT_MASS_WEB_FATTURE_URL

    if not self._has_ivaservizi_session(page):
      page = self._bootstrap_ivaservizi_sso(page, shots)

    # Completa wizard utenza ivaservizi prima di mass-web
    if self._is_ivaservizi_utenza_wizard(page):
      page = self._complete_utenza_lavoro(page, shots)

    # Non aprire mass-web se SSO non e attivo: riprova ricerca servizio una volta
    if not self._has_ivaservizi_session(page) or self._is_ade_login_page(page):
      self._wait_area_riservata_ready(page, timeout_ms=30000)
      page = self._open_fatture_corrispettivi_sso(page, shots)
      page = self._complete_scelta_profilo_lavoro(page, shots)
      page = self._complete_utenza_lavoro(page, shots)
    if self._is_ivaservizi_utenza_wizard(page):
      page = self._complete_utenza_lavoro(page, shots)
    if not self._has_ivaservizi_session(page) or self._is_ade_login_page(page):
      self._shot(page, "03e_mass_web_no_sso", shots, force=True)
      return page

    try:
      page.goto(mass_url, wait_until="domcontentloaded", timeout=90000)
      self._attach_network_sniffer(page)
      self._attach_download_handler(page)
      self._wait_iva_spa(page, need_text="richieste", timeout_ms=60000)
    except Exception:
      pass

    if self._is_ade_login_page(page):
      self._shot(page, "03e_mass_web_login_fallback", shots, force=True)
      page = self._bootstrap_ivaservizi_sso(page, shots)
      if self._has_ivaservizi_session(page):
        try:
          page.goto(mass_url, wait_until="domcontentloaded", timeout=90000)
          self._wait_iva_spa(page, need_text="richieste", timeout_ms=60000)
        except Exception:
          pass
      else:
        return page

    body = self._page_text(page, 1500).lower()
    if "scelta profilo" in body or "scelta utenza" in body or "selezione utenza" in body:
      page = self._complete_scelta_profilo_lavoro(page, shots)
      page = self._complete_area_riservata_utenza(page, shots)
      if self._has_ivaservizi_session(page) and not self._is_ade_login_page(page):
        try:
          page.goto(mass_url, wait_until="domcontentloaded", timeout=90000)
          self._wait_iva_spa(page, need_text="richieste", timeout_ms=60000)
        except Exception:
          pass

    if self._utenza_mode() == "incaricato" and not self._is_ade_login_page(page):
      self._select_incaricante(page)
      for btn in (r"Procedi", r"Continua", r"Conferma"):
        try:
          page.get_by_role("button", name=re.compile(btn, re.I)).first.click(timeout=4000)
          self._pause(page, 400)
          break
        except Exception:
          continue

    self._shot(page, "03e_mass_web", shots)
    return page

  def _mass_web_richiesta_ricevute(self, page: Any, shots: List[str]) -> None:
    """Su mass-web: Genera richiesta fatture ricevute + periodo, poi scarica da Risposte.

    Con ADE_RISPOSTE_ONLY=1 salta Genera e controlla solo Risposte (file già richiesto).
    """
    risposte_only = _env_bool("ADE_RISPOSTE_ONLY", False)
    self._wait_iva_spa(page, need_text="richieste", timeout_ms=45000)
    self._shot(page, "03f0_mass_web_home", shots)

    # Apri sezione Fatture Elettroniche se serve
    try:
      page.get_by_text(re.compile(r"Fatture Elettroniche", re.I)).first.click(timeout=4000)
      page.wait_for_timeout(1000)
    except Exception:
      pass

    requested = False
    if not risposte_only:
      # Tipologia: Ricevute (non Emesse)
      try:
        ok = page.evaluate(
          """() => {
            const labels = Array.from(document.querySelectorAll('label, span, div'));
            const lab = labels.find(n => /^\\s*Ricevute\\s*$/i.test((n.innerText||'').trim()));
            if (!lab) return 'nolabel';
            const input = lab.querySelector('input') || document.getElementById(lab.getAttribute('for')||'')
              || lab.previousElementSibling || lab.parentElement?.querySelector('input');
            if (input && 'click' in input) { input.click(); lab.click(); return 'input'; }
            lab.click();
            return 'label';
          }"""
        )
        print(f"[{self.profile.id}] mass Ricevute={ok}", flush=True)
        page.wait_for_timeout(800)
      except Exception as e:
        print(f"[{self.profile.id}] mass Ricevute fail: {e}", flush=True)

      # Tipo data Ricezione
      try:
        page.get_by_text(re.compile(r"^Ricezione$", re.I)).first.click(timeout=3000)
        page.wait_for_timeout(400)
      except Exception:
        pass

      self._apply_invoice_search(page)
      # Forza date nei campi Dal/Al se presenti
      try:
        end = datetime.now()
        start = end - timedelta(days=max(7, self.lookback_days))
        date_from = start.strftime("%d/%m/%Y")
        date_to = end.strftime("%d/%m/%Y")
        page.evaluate(
          """([df, dt]) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const dal = inputs.find(i => /dal/i.test(i.name||'') || /dal/i.test(i.id||'')
              || /dal/i.test(i.getAttribute('aria-label')||'') || /dal/i.test(i.placeholder||''));
            const al = inputs.find(i => (/^al$/i.test(i.name||'') || /^al$/i.test(i.id||'')
              || /\\bal\\b/i.test(i.getAttribute('aria-label')||'') || /^al$/i.test(i.placeholder||''))
              && i !== dal);
            // fallback: primi due date-like vicino a Data
            const dateInputs = inputs.filter(i => /date|data|gg\\/mm/i.test(i.placeholder||i.name||i.id||'')
              || (i.type === 'text' && i.offsetParent));
            const a = dal || dateInputs[0];
            const b = al || dateInputs[1];
            if (a) { a.focus(); a.value = df; a.dispatchEvent(new Event('input', {bubbles:true})); a.dispatchEvent(new Event('change', {bubbles:true})); }
            if (b) { b.focus(); b.value = dt; b.dispatchEvent(new Event('input', {bubbles:true})); b.dispatchEvent(new Event('change', {bubbles:true})); }
            return !!(a && b);
          }""",
          [date_from, date_to],
        )
      except Exception:
        pass

      self._shot(page, "03f_mass_tipo_periodo", shots)

      # Genera richiesta (bottone corretto AdE)
      for btn in (
        r"^Genera richiesta$",
        r"Genera richiesta",
        r"Invia richiesta",
        r"Richiedi",
      ):
        try:
          page.get_by_role("button", name=re.compile(btn, re.I)).first.click(timeout=5000)
          page.wait_for_timeout(2500)
          requested = True
          break
        except Exception:
          try:
            page.evaluate(
              """() => {
                const b = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit]'))
                  .find(n => /genera richiesta/i.test((n.innerText||n.value||'').trim()));
                if (!b) return false;
                b.click();
                return true;
              }"""
            )
            page.wait_for_timeout(2500)
            requested = True
            break
          except Exception:
            continue

      self._shot(page, "03f1_mass_richiesta_inviata", shots, force=True)

      # Dopo Genera compare modal con XML: serve "Invia richiesta" (non solo Genera)
      try:
        page.wait_for_timeout(1000)
        # Elenca tutti i bottoni Invia + click su quello accanto a "Download richiesta (xml)"
        invia_info = page.evaluate(
          """() => {
            const nodes = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit]'));
            const inviaAll = nodes.filter(n => /^\\s*Invia richiesta\\s*$/i.test((n.innerText||n.value||'').trim()));
            const meta = inviaAll.map((b, i) => {
              const r = b.getBoundingClientRect();
              let nearDownload = false;
              let p = b.parentElement;
              for (let k=0; k<8 && p; k++, p=p.parentElement) {
                const t = p.innerText||'';
                // Contenitore stretto del modal (non body intera)
                if (t.length < 1200
                    && /Download richiesta/i.test(t)
                    && /Invia richiesta/i.test(t)
                    && /Richiesta generata|XML generato/i.test(t)) {
                  nearDownload = true; break;
                }
              }
              return {i, nearDownload, x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height};
            });
            // Nel modal Invia è a DESTRA di Download → preferisci nearDownload con x maggiore
            const modalish = meta.filter(m => m.nearDownload);
            let pick = null;
            if (modalish.length) pick = modalish.slice().sort((a,b)=>b.x-a.x)[0];
            else if (meta.length) pick = meta.slice().sort((a,b)=>b.x-a.x)[0];
            return {meta, pick};
          }"""
        )
        print(f"[{self.profile.id}] mass Invia bottoni={invia_info}", flush=True)
        inviata = False
        pick = (invia_info or {}).get("pick") or {}
        if pick.get("x") is not None:
          idx = int(pick.get("i", 0))
          clicked_ok = False
          # 1) locator button per testo (Angular mass-web)
          try:
            loc = page.locator("button").filter(has_text=re.compile(r"^\s*Invia richiesta\s*$", re.I))
            n = loc.count()
            print(f"[{self.profile.id}] mass Invia locator count={n} pick_i={idx}", flush=True)
            if n > 0:
              el = loc.nth(min(idx, n - 1))
              el.scroll_into_view_if_needed(timeout=3000)
              el.click(timeout=8000, force=True)
              clicked_ok = True
              print(f"[{self.profile.id}] mass Invia locator.click ok", flush=True)
          except Exception as e1:
            print(f"[{self.profile.id}] mass Invia locator fail: {e1}", flush=True)
          # 2) mouse CSS coords
          if not clicked_ok:
            try:
              page.mouse.click(float(pick["x"]), float(pick["y"]))
              clicked_ok = True
              print(f"[{self.profile.id}] mass Invia mouse=({pick['x']:.0f},{pick['y']:.0f}) i={idx}", flush=True)
            except Exception as e2:
              print(f"[{self.profile.id}] mass Invia mouse fail: {e2}", flush=True)
          # 3) JS click sull'elemento all'indice
          if not clicked_ok:
            try:
              page.evaluate(
                """(i) => {
                  const nodes = Array.from(document.querySelectorAll('button'))
                    .filter(n => /^\\s*Invia richiesta\\s*$/i.test((n.innerText||'').trim()));
                  const b = nodes[i] || nodes[nodes.length-1];
                  if (!b) return false;
                  b.focus();
                  b.click();
                  return true;
                }""",
                idx,
              )
              clicked_ok = True
            except Exception as e3:
              print(f"[{self.profile.id}] mass Invia js fail: {e3}", flush=True)
          inviata = clicked_ok
          # Secondo tentativo: anche l'altro bottone Invia (se il primo non apre presa in carico)
          page.wait_for_timeout(1500)
          if not page.evaluate("() => /presa in carico|Identificativo\\\\s+richiesta/i.test(document.body.innerText||'')"):
            try:
              loc = page.locator("button").filter(has_text=re.compile(r"^\s*Invia richiesta\s*$", re.I))
              for j in range(loc.count()):
                if j == idx:
                  continue
                loc.nth(j).click(timeout=5000, force=True)
                print(f"[{self.profile.id}] mass Invia retry nth={j}", flush=True)
                page.wait_for_timeout(2000)
                if page.evaluate("() => /presa in carico/i.test(document.body.innerText||'')"):
                  break
            except Exception as e4:
              print(f"[{self.profile.id}] mass Invia retry fail: {e4}", flush=True)
        print(f"[{self.profile.id}] mass Invia richiesta={inviata}", flush=True)
        for _ in range(18):
          page.wait_for_timeout(1000)
          try:
            page.get_by_role("button", name=re.compile(r"^(Conferma|OK|Si|Sì|Chiudi)$", re.I)).first.click(
              timeout=600
            )
          except Exception:
            pass
          ready = page.evaluate(
            """() => {
              const t = (document.body && document.body.innerText) || '';
              return /presa in carico/i.test(t) || /Identificativo\\s+richiesta/i.test(t);
            }"""
          )
          if ready:
            break
        self._shot(page, "03f1b_mass_dopo_invia", shots, force=True)
      except Exception as e:
        print(f"[{self.profile.id}] mass Invia richiesta fail: {e}", flush=True)

      # Conferma modal "Richiesta generata" + Identificativo richiesta
      try:
        page.wait_for_timeout(1000)
        info = page.evaluate(
          """() => {
            const t = (document.body && (document.body.innerText || '')) || '';
            const presa = /presa in carico|correttamente acquisita|identificativo\\s+richiesta|acquisita con identificativo/i.test(t);
            let id = '';
            const m1 = t.match(/Identificativo\\s+richiesta[^\\d\\n]*([0-9]{10,})/i)
              || t.match(/acquisita con identificativo\\s*([0-9]{10,})/i)
              || t.match(/identificativo\\s+([0-9]{10,})/i);
            if (m1) id = m1[1];
            if (!id) {
              const m2 = t.match(/\\b([0-9]{20,})\\b/);
              if (m2) id = m2[1];
            }
            return {presa: !!presa, id, snip: t.replace(/\\s+/g, ' ').slice(0, 500)};
          }"""
        )
        rid = (info or {}).get("id") or ""
        presa = bool((info or {}).get("presa"))
        if rid or presa:
          requested = True
        print(
          f"[{self.profile.id}] mass Genera richiesta={requested} "
          f"presa_in_carico={presa} identificativo={rid or '-'}",
          flush=True,
        )
        if (info or {}).get("snip"):
          print(f"[{self.profile.id}] mass modal: {(info or {}).get('snip')}", flush=True)
      except Exception as e:
        print(f"[{self.profile.id}] mass Genera richiesta={requested} (modal parse fail: {e})", flush=True)
    else:
      print(f"[{self.profile.id}] mass ADE_RISPOSTE_ONLY=1 (skip Genera)", flush=True)

    # Vai su Risposte: elenco con Identificativo richiesta / stato / Scarica
    try:
      page.get_by_role("link", name=re.compile(r"^Risposte$", re.I)).first.click(timeout=5000)
      page.wait_for_timeout(2000)
    except Exception:
      try:
        page.get_by_text(re.compile(r"^Risposte$", re.I)).first.click(timeout=4000)
        page.wait_for_timeout(2000)
      except Exception:
        pass

    # Attendi fine spinner / tabella elenco (mass-web SPA)
    for _ in range(40):
      ready = page.evaluate(
        """() => {
          const t = (document.body && document.body.innerText) || '';
          if (/non risultano inserite richieste/i.test(t)) return 'empty';
          if (/Elaborat|predisposta|Identificativo|Scarica|\\d{15,}/i.test(t)
              && !/Elenco risposte\\s*$/i.test(t.trim())) return 'ready';
          const spin = document.querySelector(
            '.spinner, .loading, [class*=spinner], [class*=loading], [role=progressbar]'
          );
          if (spin && spin.offsetParent) return 'spin';
          // tabella con righe
          const rows = document.querySelectorAll('table tbody tr, [class*=table] tr, mat-row, .ui-datatable-data tr');
          if (rows && rows.length > 0) return 'ready';
          return 'wait';
        }"""
      )
      if ready in ("ready", "empty"):
        print(f"[{self.profile.id}] risposte load={ready}", flush=True)
        break
      page.wait_for_timeout(1500)
    else:
      print(f"[{self.profile.id}] risposte load=timeout", flush=True)

    self._shot(page, "03f2_mass_risposte", shots, force=True)

    try:
      status_snip = page.evaluate(
        """() => {
          const t = (document.body && (document.body.innerText || '')) || '';
          const lines = t.split(/\\n+/).map(s => s.trim()).filter(Boolean);
          const hit = lines.filter(l =>
            /rispost|scarica|disponib|elabor|pronta|predisposta|errore|zip|fattur|richiest|identificativo|[0-9]{10,}/i.test(l)
          ).slice(0, 40);
          return hit.join(' | ').slice(0, 1500);
        }"""
      )
      print(f"[{self.profile.id}] risposte status: {status_snip}", flush=True)
    except Exception:
      pass

    # Attendi elaborazione e scarica (più tentativi se check-only: file già pronto)
    attempts = 8 if risposte_only else 10
    got = False
    for attempt in range(attempts):
      try:
        # Apri menu/dettaglio riga Elaborata (icona ☰ / Dettaglio Risposta)
        try:
          opened = page.evaluate(
            """() => {
              const row = Array.from(document.querySelectorAll('tr, [role=row], mat-row, li, .row'))
                .find(r => /elaborat|predisposta/i.test(r.innerText||'') && /\\d{15,}/.test(r.innerText||''));
              if (!row) return 'norow';
              const btns = Array.from(row.querySelectorAll('button,a,[role=button],i,span'));
              // Preferisci icona hamburger / dettaglio / download
              let el = btns.find(n => {
                const t = ((n.getAttribute('title')||'') + ' ' + (n.getAttribute('aria-label')||'')
                  + ' ' + (n.innerText||'') + ' ' + (n.className||'')).toLowerCase();
                return /dettaglio|menu|more|azioni|opzioni|hamburger|bars|list/i.test(t);
              });
              if (!el) {
                // ultimo controllo cliccabile nella riga (di solito icona a destra)
                const clickable = btns.filter(n => {
                  const r = n.getBoundingClientRect();
                  return r.width > 8 && r.height > 8 && r.x > 200;
                });
                el = clickable[clickable.length - 1];
              }
              if (!el) return 'nobtn';
              el.click();
              return 'ok';
            }"""
          )
          print(f"[{self.profile.id}] risposte dettaglio={opened}", flush=True)
          page.wait_for_timeout(1500)
          self._shot(page, f"03f2b_dettaglio_{attempt}", shots, force=True)
        except Exception as e:
          print(f"[{self.profile.id}] risposte dettaglio fail: {e}", flush=True)

        # Flusso AdE Risposte (semplice):
        # 1) riga Elaborata + pulsante blu (dettaglio)
        # 2) popup "Dati della Risposta" → apri "File prodotti"
        # 3) scarica ZIP fatture (NON "download file della richiesta")
        with page.expect_download(timeout=25000) as dl_info:
          clicked = False
          try:
            page.get_by_text(re.compile(r"File prodotti", re.I)).first.click(timeout=3000)
            page.wait_for_timeout(800)
          except Exception:
            try:
              page.evaluate(
                """() => {
                  const el = Array.from(document.querySelectorAll('a,button,div,span,summary'))
                    .find(n => /File prodotti/i.test((n.innerText||'').trim()));
                  if (el) el.click();
                }"""
              )
              page.wait_for_timeout(800)
            except Exception:
              pass
          self._shot(page, f"03f2c_file_prodotti_{attempt}", shots, force=True)

          for name in (
            r"download file prodotto",
            r"Scarica file prodotto",
            r"file prodotto",
            r"Scarica ZIP",
            r"Scarica risposta",
            r"^Scarica$",
            r"\.zip",
          ):
            try:
              page.get_by_role("button", name=re.compile(name, re.I)).first.click(timeout=2500)
              clicked = True
              break
            except Exception:
              pass
            try:
              page.get_by_role("link", name=re.compile(name, re.I)).first.click(timeout=2500)
              clicked = True
              break
            except Exception:
              pass
          if not clicked:
            ok = page.evaluate(
              """() => {
                // Solo dentro "File prodotti" — evita "download file della richiesta"
                const sections = Array.from(document.querySelectorAll('div,section,details,li'))
                  .filter(n => /File prodotti/i.test(n.innerText||'') && (n.innerText||'').length < 4000);
                const scopes = sections.length ? sections : [document.body];
                for (const scope of scopes) {
                  const el = Array.from(scope.querySelectorAll('a,button,[role=button],i,span'))
                    .find(n => {
                      const t = ((n.innerText||n.textContent||'') + ' ' + (n.getAttribute('title')||'')
                        + ' ' + (n.getAttribute('aria-label')||'') + ' ' + (n.className||'')).toLowerCase();
                      if (/file della richiesta|fileinput/i.test(t)) return false;
                      return /prodotto|scarica|download|\\.zip|cloud_download|file_download/i.test(t);
                    });
                  if (el) { el.click(); return 'ok'; }
                }
                const el2 = Array.from(document.querySelectorAll('a,button'))
                  .find(n => {
                    const t = (n.innerText||n.textContent||'').trim();
                    if (/file della richiesta/i.test(t)) return false;
                    return /file prodotto|scarica|download|\\.zip/i.test(t);
                  });
                if (!el2) return false;
                el2.click();
                return 'fallback';
              }"""
            )
            if not ok:
              raise RuntimeError("no product download control")
            clicked = True
            print(f"[{self.profile.id}] risposte download click={ok}", flush=True)
          if not clicked:
            raise RuntimeError("no download control")
        download = dl_info.value
        suggested = download.suggested_filename or f"ade_mass_{attempt}.zip"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        raw = target.read_bytes()
        if _is_ade_mass_request_xml(raw) or (
          suggested.lower().endswith(".xml") and b"InputMassivo" in raw[:2000]
        ):
          print(f"[{self.profile.id}] scaricato richiesta XML (skip): {suggested}", flush=True)
          raise RuntimeError("got request xml not product zip")
        before = len(self._xml_captures)
        self._remember(raw, suggested, f"mass:risposte:{attempt}")
        try:
          if self.profile.drop_dir:
            ddir = Path(self.profile.drop_dir)
            ddir.mkdir(parents=True, exist_ok=True)
            (ddir / suggested).write_bytes(raw)
        except Exception:
          pass
        print(
          f"[{self.profile.id}] scaricato {suggested} size={target.stat().st_size} "
          f"xml_ok={len(self._xml_captures)-before}",
          flush=True,
        )
        got = True
        break
      except Exception as e:
        print(f"[{self.profile.id}] risposte download attempt={attempt} fail: {e}", flush=True)
        try:
          page.get_by_role("button", name=re.compile(r"Aggiorna|Ricarica|Refresh", re.I)).first.click(
            timeout=2000
          )
        except Exception:
          try:
            page.reload(wait_until="domcontentloaded", timeout=20000)
          except Exception:
            pass
        page.wait_for_timeout(5000)
        try:
          page.wait_for_timeout(3000)
        except Exception:
          pass

    if not got:
      self._shot(page, "03f3_mass_risposte_non_pronte", shots, force=True)
      print(f"[{self.profile.id}] risposte: nessun download pronto", flush=True)

    if not risposte_only and not requested:
      self._shot(page, "03f_mass_richiesta_fail", shots, force=True)

  def _complete_utenza_lavoro(self, page: Any, shots: List[str]) -> Any:
    """Portale IVA / area riservata: configura utenza (Me stesso o Incaricato + P.IVA)."""
    # Prima gestisci wizard area riservata (Cambia/Selezione utenza)
    if self._is_area_utenza_page(page):
      return self._complete_area_riservata_utenza(page, shots)

    piva = self._piva_digits()
    mode = self._utenza_mode()
    body = self._page_text(page, 2000).lower()
    body_digits = re.sub(r"\D", "", body)

    # Sessione già attiva ma P.IVA diversa → cambia utenza (solo area riservata)
    if (
      piva
      and piva not in body_digits
      and self._is_area_riservata_home(page)
      and not self._is_ivaservizi_utenza_wizard(page)
    ):
      for label in (r"Cambia utenza di lavoro", r"Cambia utenza"):
        try:
          page.get_by_text(re.compile(label, re.I)).first.click(timeout=5000)
          page.wait_for_timeout(2500)
          body = self._page_text(page, 2000).lower()
          break
        except Exception:
          continue
      if self._is_area_utenza_page(page):
        return self._complete_area_riservata_utenza(page, shots)

    on_wizard = self._is_ivaservizi_utenza_wizard(page) or any(
      s in body
      for s in (
        "configura l'utenza",
        "scegli utenza di lavoro",
      )
    )
    if not on_wizard:
      if piva and piva in body_digits:
        return page
      if "monitoraggio" in (page.url or "").lower() or "mass-web" in (page.url or "").lower():
        return page
      return page

    if mode == "incaricato":
      try:
        # Card Incaricato (non confondere con testo descrittivo)
        page.locator("div, label, button, a").filter(has_text=re.compile(r"^Incaricato$", re.I)).first.click(
          timeout=6000
        )
        page.wait_for_timeout(800)
      except Exception:
        try:
          page.get_by_text(re.compile(r"^Incaricato$", re.I)).first.click(timeout=5000)
          page.wait_for_timeout(800)
        except Exception:
          pass
    else:
      try:
        page.get_by_text(re.compile(r"^Me stesso$", re.I)).first.click(timeout=5000)
        page.wait_for_timeout(800)
      except Exception:
        pass

    try:
      page.get_by_role("button", name=re.compile(r"Procedi|Continua", re.I)).first.click(timeout=8000)
      page.wait_for_timeout(2500)
    except Exception:
      try:
        page.evaluate(
          """() => {
            const b = Array.from(document.querySelectorAll('button,a')).find(n =>
              /^\\s*(Procedi|Continua)\\s*$/i.test((n.innerText||'').trim()));
            if (b) { b.click(); return true; }
            return false;
          }"""
        )
        page.wait_for_timeout(2500)
      except Exception:
        pass

    if mode == "incaricato":
      self._wait_iva_spa(page, need_text="soggetto", timeout_ms=20000)
      self._select_incaricante(page)
      self._shot(page, "03d1_piva_selezionata", shots)
      try:
        page.get_by_role("button", name=re.compile(r"Procedi|Continua|Conferma", re.I)).first.click(timeout=8000)
        page.wait_for_timeout(2500)
      except Exception:
        pass

    for _ in range(4):
      body = self._page_text(page, 800).lower()
      if "riepilogo" in body or "conferma" in body:
        try:
          page.get_by_role("button", name=re.compile(r"Procedi|Conferma|Continua", re.I)).first.click(
            timeout=8000
          )
          page.wait_for_timeout(2500)
        except Exception:
          break
      elif "configura l'utenza" not in body and "scegli utenza" not in body:
        break
      else:
        try:
          page.get_by_role("button", name=re.compile(r"Procedi|Conferma|Continua", re.I)).first.click(
            timeout=6000
          )
          page.wait_for_timeout(2000)
        except Exception:
          break

    # Attendi monitoraggio / portale IVA
    if "ivaservizi" in (page.url or "").lower() or "instr" in (page.url or "").lower():
      try:
        page.wait_for_url(re.compile(r"monitoraggio|mass-web|ivaservizi", re.I), timeout=60000)
      except Exception:
        pass
      self._wait_iva_spa(page, need_text="monitoraggio", timeout_ms=30000)

    self._shot(page, "03d_utenza_lavoro", shots)
    print(f"[{self.profile.id}] utenza ivaservizi ok url={getattr(page, 'url', '')}", flush=True)
    return page

  def _wait_iva_spa(self, page: Any, *, need_text: str = "", timeout_ms: int = 45000) -> None:
    """Attende rendering SPA ivaservizi (body inizialmente vuoto)."""
    try:
      page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    except Exception:
      pass
    try:
      page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:
      pass
    needle = (need_text or "monitoraggio").lower()
    try:
      page.wait_for_function(
        f"() => (document.body && document.body.innerText && "
        f"document.body.innerText.toLowerCase().includes({needle!r}))",
        timeout=timeout_ms,
      )
    except Exception:
      try:
        page.wait_for_function(
          "() => document.body && document.body.innerText && document.body.innerText.length > 250",
          timeout=timeout_ms,
        )
      except Exception:
        pass
    page.wait_for_timeout(1500)

  def _click_monitoraggio_fatture_ricevute(self, page: Any) -> bool:
    """Clic su «Fatture ricevute» nella home monitoraggio IVA (SPA Angular)."""
    self._wait_iva_spa(page, need_text="monitoraggio", timeout_ms=60000)

    def _on_ricevute_page() -> bool:
      body = self._page_text(page, 1500).lower()
      url = (page.url or "").lower()
      if "fattureb2b/ricevute" in url or "fattureb2b/ricevute" in url.replace("%2f", "/"):
        return True
      if "fatture trasmesse" in body[:350] or "fatture emesse" in body[:350]:
        return False
      if "monitoraggio delle ricevute" in body[:350]:
        return False
      return "fatture ricevute" in body[:400] or "ricerca" in body[:400]

    direct = _env("ADE_FATTURE_RICEVUTE_URL") or (
      "https://ivaservizi.agenziaentrate.gov.it/ser/monitoraggio/#/fattureB2B/ricevute/ricerca"
    )
    try:
      page.goto(direct, wait_until="domcontentloaded", timeout=90000)
      self._wait_iva_spa(page, need_text="ricerca", timeout_ms=60000)
      if _on_ricevute_page():
        return True
    except Exception:
      pass

    if "monitoraggio" not in (page.url or "").lower():
      return False

    # Router Angular: hash change più affidabile di page.goto
    try:
      page.evaluate("() => { window.location.hash = '#/fattureB2B/ricevute/ricerca'; }")
      self._wait_iva_spa(page, need_text="ricerca", timeout_ms=60000)
      if _on_ricevute_page():
        return True
    except Exception:
      pass

    # Route Angular nota (link spesso non «visible» nel DOM)
    base = (page.url or "").split("#")[0]
    routes = (
      "#/fattureB2B/ricevute/ricerca",
      "#/fattureB2B/ricevute",
      "#/fatture/ricevute/ricerca",
    )
    for route in routes:
      try:
        page.goto(f"{base}{route}", wait_until="domcontentloaded", timeout=60000)
        self._wait_iva_spa(page, need_text="fatture", timeout_ms=45000)
        if _on_ricevute_page():
          return True
      except Exception:
        continue

    for sel in (
      'a[href="#/fattureB2B/ricevute/ricerca"]',
      'a[href*="fattureB2B/ricevute"]',
    ):
      try:
        loc = page.locator(sel)
        if loc.count() > 0:
          loc.first.click(timeout=8000, force=True)
          self._wait_iva_spa(page, need_text="fatture", timeout_ms=45000)
          if _on_ricevute_page():
            return True
      except Exception:
        continue

    return _on_ricevute_page()

  def _goto_fatture_ricevute_consultazione(self, page: Any, shots: List[str]) -> Any:
    """Apri consultazione / download fatture ricevute (mass-web o monitoraggio)."""
    if self._is_ade_login_page(page):
      page = self._bootstrap_ivaservizi_sso(page, shots)

    active = self._complete_scelta_profilo_lavoro(page, shots)
    active = self._complete_utenza_lavoro(active, shots)

    use_mass = (
      self._piva_digits()
      and self._utenza_mode() == "incaricato"
      and _env("ADE_USE_MASS_WEB", "1") not in ("0", "false", "no")
    )

    if use_mass:
      active = self._navigate_mass_web_fatture(active, shots)
      self._shot(active, "03c_fatture_ricevute_list", shots)
      return active

    if "monitoraggio" in (active.url or "").lower():
      self._wait_iva_spa(active, need_text="monitoraggio", timeout_ms=60000)
    body = self._page_text(active, 1200).lower()
    if "le tue fatture" in body and "fatture individuate" in body:
      return active

    if "monitoraggio" in body or "home monitoraggio" in body or "monitoraggio" in (active.url or "").lower():
      self._click_monitoraggio_fatture_ricevute(active)
      active.wait_for_timeout(2000)
      self._shot(active, "03c_fatture_ricevute_list", shots)
      return active

    for label in (
      r"Fatture ricevute",
      r"Consultazione fatture ricevute",
      r"Consultazione delle fatture ricevute",
      r"Ricevute",
      r"Consultazione",
    ):
      try:
        loc = active.get_by_role("link", name=re.compile(label, re.I))
        if loc.count() > 0:
          loc.first.click(timeout=6000)
          active.wait_for_timeout(2000)
          break
      except Exception:
        try:
          active.get_by_text(re.compile(f"^{label}$", re.I)).first.click(timeout=4000)
          active.wait_for_timeout(2000)
          break
        except Exception:
          continue

    self._shot(active, "03c_fatture_ricevute_list", shots)
    return active

  def _apply_invoice_search(self, page: Any) -> None:
    """Imposta intervallo date e avvia ricerca fatture."""
    end = datetime.now()
    start = end - timedelta(days=max(7, self.lookback_days))
    date_from = start.strftime("%d/%m/%Y")
    date_to = end.strftime("%d/%m/%Y")

    for label_re in (
      r"dal",
      r"data.*da",
      r"data di emissione.*dal",
    ):
      try:
        loc = page.get_by_label(re.compile(label_re, re.I))
        if loc.count() > 0:
          loc.first.fill(date_from, timeout=3000)
          break
      except Exception:
        continue

    for label_re in (
      r"^al$",
      r"data.*a",
      r"data di emissione.*al",
    ):
      try:
        loc = page.get_by_label(re.compile(label_re, re.I))
        if loc.count() > 0:
          loc.first.fill(date_to, timeout=3000)
          break
      except Exception:
        continue

  def _try_download_xml(self, page: Any, shots: List[str]) -> None:
    before = len(self._xml_captures)
    on_mass = "mass-web" in (page.url or "").lower()
    if not on_mass:
      page = self._goto_fatture_ricevute_consultazione(page, shots)
    self._wait_iva_spa(page, need_text="fatture", timeout_ms=30000)

    if "mass-web" in (page.url or "").lower():
      self._mass_web_richiesta_ricevute(page, shots)

    self._apply_invoice_search(page)

    try:
      page.get_by_role("button", name=re.compile(r"^Cerca$", re.I)).first.click(timeout=4000)
      page.wait_for_timeout(2500)
    except Exception:
      pass

    # Esporta tabella / bulk
    for name in (
      "Esporta la tabella",
      "Esporta",
      "Scarica tutto",
      "Scarica XML",
      "Scarica file",
      "ZIP",
      "Download",
      "Scarica",
    ):
      try:
        with page.expect_download(timeout=8000) as dl_info:
          page.get_by_role("button", name=re.compile(name, re.I)).first.click(timeout=3000)
        download = dl_info.value
        suggested = download.suggested_filename or "ade.xml"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        self._remember(target.read_bytes(), suggested, f"btn:{name}")
      except Exception:
        try:
          with page.expect_download(timeout=6000) as dl_info:
            page.get_by_text(re.compile(name, re.I)).first.click(timeout=2500)
          download = dl_info.value
          suggested = download.suggested_filename or "ade.xml"
          target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
          download.save_as(str(target))
          self._remember(target.read_bytes(), suggested, f"text:{name}")
        except Exception:
          pass

    # Scarica da righe tabella (icone / link)
    try:
      rows = page.locator("table tbody tr")
      n = min(rows.count(), 30)
      for i in range(n):
        row = rows.nth(i)
        for sel in (
          'a[title*="Scarica"], button[title*="Scarica"]',
          'a[href*=".xml"], a[href*="download"]',
          "td:last-child a, td:last-child button",
        ):
          try:
            icon = row.locator(sel)
            if icon.count() == 0:
              continue
            with page.expect_download(timeout=6000) as dl_info:
              icon.first.click(timeout=2500)
            download = dl_info.value
            suggested = download.suggested_filename or f"fattura_{i}.xml"
            target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
            download.save_as(str(target))
            self._remember(target.read_bytes(), suggested, f"row:{i}")
            break
          except Exception:
            try:
              with page.expect_popup(timeout=4000) as popup_info:
                row.locator(sel).first.click(timeout=2000)
              detail = popup_info.value
              self._attach_network_sniffer(detail)
              self._attach_download_handler(detail)
              detail.wait_for_timeout(1500)
              for dl_name in ("Scarica XML", "Scarica", "Download"):
                try:
                  with detail.expect_download(timeout=5000) as dl_info:
                    detail.get_by_role("button", name=re.compile(dl_name, re.I)).first.click(timeout=2000)
                  download = dl_info.value
                  suggested = download.suggested_filename or f"fattura_{i}.xml"
                  target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
                  download.save_as(str(target))
                  self._remember(target.read_bytes(), suggested, f"detail:{i}")
                  break
                except Exception:
                  continue
              try:
                detail.close()
              except Exception:
                pass
              break
            except Exception:
              continue
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
        "fisconline",
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
        # Se c'è sessione salvata, prova prima senza rifare login
        auth_mode = (self.profile.auth_mode or "cns").lower()
        if storage and storage.is_file() and auth_mode in ("storage", "fisconline"):
          area_url = self._area_riservata_url()
          page.goto(area_url, wait_until="domcontentloaded", timeout=60000)
          page = self._ensure_logged_in_home(page, shots)
          login_ok = self._wait_logged_in(page, shots, skip_cns_click=True)
          if not login_ok:
            login_ok = self._perform_login(page, shots)
        else:
          login_ok = self._perform_login(page, shots)
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

          page = self._navigate_after_login(page, shots)
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
        keep_session = _env_bool("ADE_KEEP_SESSION", (self.profile.auth_mode or "").lower() == "fisconline")
        if not keep_session:
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
