"""
Client Playwright per Passcom Live (WebDesk canvas).

Login HTTP form (Dominio/Utente/Password) → WebDesk → Docuvision →
Fatture elettroniche → Fatture ricevute → download XML → bytes.

L'UI è canvas: navigazione a tastiera + click calibrati + intercept download/rete.
"""
from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

CHROME_UA = (
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
  "AppleWebKit/537.36 (KHTML, like Gecko) "
  "Chrome/144.0.0.0 Safari/537.36"
)


@dataclass
class DownloadedXml:
  filename: str
  data: bytes
  sha256: str
  source: str = "download"


@dataclass
class PasscomSyncResult:
  ok: bool
  message: str
  downloaded: List[DownloadedXml] = field(default_factory=list)
  screenshots: List[str] = field(default_factory=list)
  login_ok: bool = False
  navigated: bool = False


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


class PasscomPlaywrightClient:
  """Sessione Passcom Live via Playwright Chromium."""

  def __init__(
    self,
    *,
    domain: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    base_url: Optional[str] = None,
    debug_dir: Optional[Path] = None,
    headless: Optional[bool] = None,
    lookback_days: Optional[int] = None,
  ) -> None:
    self.domain = domain or _env("PASSCOM_DOMAIN")
    self.username = username or _env("PASSCOM_USERNAME")
    self.password = password or _env("PASSCOM_PASSWORD")
    self.base_url = (
      base_url
      or _env("PASSCOM_BASE_URL", "https://webdesk.passgo.cloud/webdesk/wd")
    )
    self.lookback_days = lookback_days if lookback_days is not None else _env_int("PASSCOM_LOOKBACK_DAYS", 30)
    self.headless = headless if headless is not None else _env_bool("PASSCOM_HEADLESS", True)
    debug_raw = _env("PASSCOM_DEBUG_DIR")
    if debug_dir is not None:
      debug = Path(debug_dir)
    elif debug_raw:
      debug = Path(debug_raw)
    else:
      debug = Path(__file__).resolve().parents[2] / "uploads" / "passcom_debug"
    self.debug_dir = Path(debug)
    self.debug_dir.mkdir(parents=True, exist_ok=True)

    self._xml_captures: List[DownloadedXml] = []
    self._download_dir = self.debug_dir / "downloads"
    self._download_dir.mkdir(parents=True, exist_ok=True)

  def ensure_credentials(self) -> None:
    missing = []
    if not self.domain:
      missing.append("PASSCOM_DOMAIN")
    if not self.username:
      missing.append("PASSCOM_USERNAME")
    if not self.password:
      missing.append("PASSCOM_PASSWORD")
    if missing:
      raise RuntimeError(f"Credenziali Passcom mancanti: {', '.join(missing)}")

  def _shot(self, page: Any, name: str, shots: List[str]) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = self.debug_dir / f"{ts}_{name}.png"
    try:
      page.screenshot(path=str(path), full_page=True)
      shots.append(str(path))
    except Exception:
      pass

  def _remember_bytes(self, data: bytes, filename: str, source: str) -> None:
    if not data or len(data) < 40:
      return
    # XML or ZIP
    is_zip = data[:2] == b"PK"
    looks_xml = b"<" in data[:200] and (
      b"FatturaElettronica" in data or b"p:FatturaElettronica" in data or b"Fattura" in data[:800]
    )
    if not is_zip and not looks_xml:
      # still allow .xml by name
      if not filename.lower().endswith(".xml"):
        return
    sha = hashlib.sha256(data).hexdigest()
    if any(x.sha256 == sha for x in self._xml_captures):
      return
    safe_name = re.sub(r"[^\w.\-]+", "_", filename or f"passcom_{sha[:12]}.xml")[:180]
    self._xml_captures.append(DownloadedXml(filename=safe_name, data=data, sha256=sha, source=source))

  def _attach_network_sniffer(self, page: Any) -> None:
    def on_response(response: Any) -> None:
      try:
        url = (response.url or "").lower()
        ct = (response.headers.get("content-type") or "").lower()
        if response.status >= 400:
          return
        interesting = (
          ".xml" in url
          or "fatturapa" in url
          or "fattura" in url and "xml" in url
          or "application/xml" in ct
          or "text/xml" in ct
          or ("zip" in ct and ("fattur" in url or "sdi" in url or "docuvision" in url))
        )
        if not interesting:
          return
        body = response.body()
        name = url.split("?")[0].rstrip("/").split("/")[-1] or "network.xml"
        if not name.lower().endswith((".xml", ".zip")):
          name = f"{name}.xml" if "zip" not in ct else f"{name}.zip"
        self._remember_bytes(body, name, "network")
      except Exception:
        return

    page.on("response", on_response)

  def _attach_download_handler(self, page: Any) -> None:
    def on_download(download: Any) -> None:
      try:
        suggested = download.suggested_filename or "download.xml"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        data = target.read_bytes()
        self._remember_bytes(data, suggested, "download")
      except Exception:
        return

    page.on("download", on_download)

  def _login(self, page: Any, shots: List[str]) -> bool:
    page.goto(self.base_url, wait_until="domcontentloaded", timeout=90_000)
    page.wait_for_timeout(800)

    # Form fields: demetra / urania / pasifae (obfuscated names)
    pass_sel = 'input[name="pasifae"], input[type="password"]'

    # Fill via JS for reliability (same as manual probe)
    page.evaluate(
      """([domain, user, password]) => {
        const form = document.forms.loginform || document.querySelector('form');
        if (!form) return false;
        const set = (name, val) => {
          const el = form.querySelector(`[name="${name}"]`) || document.querySelector(`[name="${name}"]`);
          if (el) { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); }
        };
        set('demetra', domain);
        set('urania', user);
        set('pasifae', password);
        if (typeof aggiornaAction === 'function') aggiornaAction();
        return true;
      }""",
      [self.domain, self.username, self.password],
    )

    # Also fill via Playwright API as backup
    try:
      inputs = page.locator('form[name="loginform"] input[type="text"], form input[type="text"]')
      if inputs.count() >= 2:
        inputs.nth(0).fill(self.domain)
        inputs.nth(1).fill(self.username)
      page.locator(pass_sel).first.fill(self.password)
    except Exception:
      pass

    self._shot(page, "01_login_filled", shots)

    page.evaluate(
      """() => {
        const form = document.forms.loginform || document.querySelector('form');
        if (!form) return;
        if (typeof aggiornaAction === 'function') aggiornaAction();
        form.submit();
      }"""
    )

    # Wait for WebDesk (title changes / canvas / no wrong-creds text)
    deadline = time.time() + 120
    while time.time() < deadline:
      title = page.title() or ""
      body = ""
      try:
        body = page.inner_text("body")[:800]
      except Exception:
        pass
      body_l = body.lower()
      if "credenziali inserite non sono corrette" in body_l:
        self._shot(page, "01_login_bad_creds", shots)
        return False
      if "browser utilizzato non è supportato" in body_l or "browser utilizzato non e supportato" in body_l:
        self._shot(page, "01_login_ua_blocked", shots)
        return False
      if "numero massimo di terminali" in body_l or "accesso non possibile" in body_l:
        self._shot(page, "01_login_max_terminals", shots)
        try:
          page.keyboard.press("Enter")
        except Exception:
          pass
        raise RuntimeError(
          "Passcom: superato il numero massimo di terminali. "
          "Chiudi tutte le altre sessioni Passcom (browser, iDesk, altri PC) e riprova."
        )
      if "sessione di lavoro terminata" in body_l:
        self._shot(page, "01_session_terminated", shots)
        raise RuntimeError(
          "Passcom: sessione terminata. Chiudi altre istanze e riprova (ricarica/login pulito)."
        )
      if "Passcom" in title or "LAMEDIAZIONE" in title.upper() or "Passepartout Passcom" in title:
        # may still be loading graphics
        if "Installazione" not in body and "Connessione" not in body and "Apertura sessione" not in body:
          self._shot(page, "02_webdesk_ready", shots)
          return True
        if "Installazione" in body or "Apertura sessione" in body or "%" in body:
          page.wait_for_timeout(2000)
          continue
        self._shot(page, "02_webdesk_ready", shots)
        return True
      # canvas present after connect dialog
      try:
        if page.locator("canvas").count() > 0 and "Accesso a Passepartout" not in body:
          page.wait_for_timeout(3000)
          body2 = page.inner_text("body")[:400]
          if "Installazione" not in body2 and "Apertura sessione" not in body2:
            if "numero massimo di terminali" in body2.lower():
              self._shot(page, "01_login_max_terminals", shots)
              raise RuntimeError(
                "Passcom: superato il numero massimo di terminali. "
                "Chiudi tutte le altre sessioni Passcom e riprova."
              )
            self._shot(page, "02_webdesk_canvas", shots)
            return True
      except RuntimeError:
        raise
      except Exception:
        pass
      page.wait_for_timeout(1500)

    self._shot(page, "01_login_timeout", shots)
    return False

  def _focus_canvas(self, page: Any) -> None:
    try:
      canvas = page.locator("canvas").first
      box = canvas.bounding_box()
      if box:
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + min(80, box["height"] / 4))
      else:
        canvas.click(timeout=3000)
    except Exception:
      page.mouse.click(200, 120)

  def _open_azienda_menu(self, page: Any) -> None:
    """Apre menu Azienda (Alt+A tipico Passcom/Mexal, fallback click)."""
    self._focus_canvas(page)
    page.wait_for_timeout(300)
    # Shortcut storico Mexal/Passcom
    page.keyboard.press("Alt+KeyA")
    page.wait_for_timeout(600)
    # Fallback: click tipico sulla voce Azienda (barra menu ~ y=50)
    page.mouse.click(70, 55)
    page.wait_for_timeout(400)

  def _navigate_to_fatture_ricevute(self, page: Any, shots: List[str]) -> bool:
    """
    Percorso: Azienda → Docuvision → Fatture elettroniche → Fatture ricevute.

    Su canvas usiamo tastiera (frecce) + eventuale Cerca.
    Coordinate override: PASSCOM_CLICK_DOCUVISION_X/Y ecc.
    """
    self._open_azienda_menu(page)
    self._shot(page, "03_azienda_menu", shots)

    # Da Apertura azienda scendi fino a Docuvision (~6–7 voci)
    for _ in range(8):
      page.keyboard.press("ArrowDown")
      page.wait_for_timeout(120)

    # Prova Enter / freccia destra per aprire submenu Docuvision
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)
    self._shot(page, "04_docuvision_attempt", shots)

    # Dentro Docuvision: cerca voci fatture elettroniche / ricevute
    # Tentativo Cerca UI (icona in alto a destra, tipico ~ x=780 y=55 su 1024)
    cerca_x = _env_int("PASSCOM_CLICK_CERCA_X", 780)
    cerca_y = _env_int("PASSCOM_CLICK_CERCA_Y", 55)
    page.mouse.click(cerca_x, cerca_y)
    page.wait_for_timeout(500)
    page.keyboard.type("Fatture ricevute", delay=40)
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    self._shot(page, "05_cerca_fatture_ricevute", shots)

    # Click calibrabile diretto su Docuvision (menu Azienda)
    doc_x = _env("PASSCOM_CLICK_DOCUVISION_X")
    doc_y = _env("PASSCOM_CLICK_DOCUVISION_Y")
    if doc_x and doc_y:
      self._open_azienda_menu(page)
      page.mouse.click(int(doc_x), int(doc_y))
      page.wait_for_timeout(800)
      self._shot(page, "04b_docuvision_click", shots)

    # Submenu fatture elettroniche / ricevute se coordinate note
    fe_x, fe_y = _env("PASSCOM_CLICK_FATTURE_ELETTRONICHE_X"), _env("PASSCOM_CLICK_FATTURE_ELETTRONICHE_Y")
    fr_x, fr_y = _env("PASSCOM_CLICK_FATTURE_RICEVUTE_X"), _env("PASSCOM_CLICK_FATTURE_RICEVUTE_Y")
    if fe_x and fe_y:
      page.mouse.click(int(fe_x), int(fe_y))
      page.wait_for_timeout(600)
    if fr_x and fr_y:
      page.mouse.click(int(fr_x), int(fr_y))
      page.wait_for_timeout(1200)
      self._shot(page, "06_fatture_ricevute", shots)
      return True

    # Navigazione freccia nel submenu Docuvision (best effort)
    for _ in range(12):
      page.keyboard.press("ArrowDown")
      page.wait_for_timeout(100)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)
    self._shot(page, "06_submenu_enter", shots)
    return True

  def _try_export_xml(self, page: Any, shots: List[str]) -> None:
    """
    Tenta export/download XML dalla lista fatture ricevute.
    Azioni tipiche: seleziona riga, Esporta / Salva / Shift+F10.
    """
    before = len(self._xml_captures)

    # Shortcut comuni Mexal/Passcom per export / stampa file
    for keys in ("Control+E", "Control+S", "Shift+F8", "F10", "Control+Shift+E"):
      try:
        with page.expect_download(timeout=2500) as dl_info:
          page.keyboard.press(keys)
        download = dl_info.value
        suggested = download.suggested_filename or "export.xml"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        self._remember_bytes(target.read_bytes(), suggested, f"shortcut:{keys}")
      except Exception:
        page.wait_for_timeout(200)

    # Click su eventuali pulsanti export (coordinate env)
    ex_x, ex_y = _env("PASSCOM_CLICK_EXPORT_X"), _env("PASSCOM_CLICK_EXPORT_Y")
    if ex_x and ex_y:
      try:
        with page.expect_download(timeout=8000) as dl_info:
          page.mouse.click(int(ex_x), int(ex_y))
        download = dl_info.value
        suggested = download.suggested_filename or "export.xml"
        target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
        download.save_as(str(target))
        self._remember_bytes(target.read_bytes(), suggested, "export_click")
      except Exception:
        self._shot(page, "07_export_click_no_download", shots)

    # Selezione prima riga lista + Invio / doppio click area lista
    list_x = _env_int("PASSCOM_CLICK_LIST_X", 400)
    list_y = _env_int("PASSCOM_CLICK_LIST_Y", 280)
    try:
      page.mouse.click(list_x, list_y)
      page.wait_for_timeout(300)
      page.mouse.dblclick(list_x, list_y)
      page.wait_for_timeout(800)
    except Exception:
      pass

    # Se non è partito download, prova menu contestuale
    try:
      page.mouse.click(list_x, list_y, button="right")
      page.wait_for_timeout(400)
      for _ in range(6):
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(80)
      with page.expect_download(timeout=4000) as dl_info:
        page.keyboard.press("Enter")
      download = dl_info.value
      suggested = download.suggested_filename or "context.xml"
      target = self._download_dir / re.sub(r"[^\w.\-]+", "_", suggested)[:180]
      download.save_as(str(target))
      self._remember_bytes(target.read_bytes(), suggested, "context_menu")
    except Exception:
      pass

    self._shot(page, "07_after_export_attempts", shots)

    # Sweep cartella download Playwright / browser
    self._sweep_download_dir()

    if len(self._xml_captures) == before:
      # Attesa extra per risposte rete lente
      page.wait_for_timeout(3000)
      self._sweep_download_dir()

  def _sweep_download_dir(self) -> None:
    for p in self._download_dir.glob("*"):
      if not p.is_file():
        continue
      if p.suffix.lower() not in (".xml", ".zip", ".p7m"):
        continue
      try:
        self._remember_bytes(p.read_bytes(), p.name, "download_dir")
      except Exception:
        continue

  def _sweep_drop_dir(self) -> None:
    """Opzionale: PASSCOM_XML_DROP_DIR con XML già esportati."""
    drop = _env("PASSCOM_XML_DROP_DIR")
    if not drop:
      return
    root = Path(drop)
    if not root.is_dir():
      return
    for p in root.rglob("*"):
      if not p.is_file():
        continue
      if p.suffix.lower() not in (".xml", ".zip", ".p7m"):
        continue
      # lookback: mtime
      try:
        age_days = (time.time() - p.stat().st_mtime) / 86400.0
        if age_days > self.lookback_days:
          continue
        self._remember_bytes(p.read_bytes(), p.name, "drop_dir")
      except Exception:
        continue

  def run_download(self) -> PasscomSyncResult:
    """Login → navigazione → collect XML bytes."""
    self.ensure_credentials()
    self._xml_captures = []
    shots: List[str] = []

    try:
      from playwright.sync_api import sync_playwright
    except ImportError as e:
      return PasscomSyncResult(
        ok=False,
        message=(
          "playwright non installato. Esegui: pip install playwright && playwright install chromium"
        ),
        screenshots=shots,
      )

    login_ok = False
    navigated = False

    with sync_playwright() as p:
      browser = p.chromium.launch(
        headless=self.headless,
        args=["--disable-dev-shm-usage"],
      )
      context = browser.new_context(
        user_agent=CHROME_UA,
        locale="it-IT",
        accept_downloads=True,
        viewport={"width": 1280, "height": 800},
      )
      page = context.new_page()
      self._attach_network_sniffer(page)
      self._attach_download_handler(page)

      try:
        login_ok = self._login(page, shots)
        if not login_ok:
          browser.close()
          return PasscomSyncResult(
            ok=False,
            message="Login Passcom fallito (credenziali, UA o timeout WebDesk)",
            screenshots=shots,
            login_ok=False,
          )

        # Lascia stabilizzare WebDesk
        page.wait_for_timeout(2500)
        navigated = self._navigate_to_fatture_ricevute(page, shots)
        self._try_export_xml(page, shots)
        self._sweep_drop_dir()

        # Se drop dir / network hanno già XML, ok anche senza export UI
        msg = (
          f"Login OK; navigazione={'ok' if navigated else 'parziale'}; "
          f"XML catturati={len(self._xml_captures)}"
        )
        if not self._xml_captures:
          msg += (
            ". Nessun XML scaricato: calibra PASSCOM_CLICK_* o esporta in PASSCOM_XML_DROP_DIR "
            f"(screenshot in {self.debug_dir})"
          )

        browser.close()
        return PasscomSyncResult(
          ok=True if self._xml_captures else False,
          message=msg,
          downloaded=list(self._xml_captures),
          screenshots=shots,
          login_ok=login_ok,
          navigated=navigated,
        )
      except Exception as e:
        self._shot(page, "99_exception", shots)
        try:
          browser.close()
        except Exception:
          pass
        return PasscomSyncResult(
          ok=False,
          message=f"Errore Passcom Playwright: {e}",
          downloaded=list(self._xml_captures),
          screenshots=shots,
          login_ok=login_ok,
          navigated=navigated,
        )


def sync_once() -> Tuple[PasscomSyncResult, List[Dict[str, Any]]]:
  """
  Esegue download + push Atlas.
  Ritorna (risultato_client, lista esiti push).
  """
  from .push_to_atlas import push_xml_bytes
  from .state import (
    default_state_path,
    load_state,
    mark_sent,
    save_state,
    sent_hash_set,
    touch_run,
  )

  state_path = Path(_env("PASSCOM_STATE_PATH") or str(default_state_path()))
  # Prefer state next to agent cwd if set
  state = load_state(state_path)
  already = sent_hash_set(state)

  client = PasscomPlaywrightClient()
  result = client.run_download()
  push_results: List[Dict[str, Any]] = []

  if not result.downloaded:
    touch_run(state, ok=False, message=result.message)
    save_state(state_path, state)
    return result, push_results

  imported = 0
  duplicates = 0
  errors = 0
  for item in result.downloaded:
    if item.sha256 in already:
      push_results.append(
        {"filename": item.filename, "sha256": item.sha256, "skipped": True, "reason": "local_state"}
      )
      duplicates += 1
      continue
    push = push_xml_bytes(item.data, filename=item.filename)
    push_results.append(
      {
        "filename": item.filename,
        "sha256": item.sha256,
        "source": item.source,
        **push,
      }
    )
    if push.get("ok"):
      mark_sent(state, item.sha256)
      already.add(item.sha256)
      res = push.get("result") or {}
      if res.get("duplicate"):
        duplicates += 1
      else:
        imported += 1
    else:
      errors += 1

  summary = (
    f"{result.message} | push imported={imported} duplicate={duplicates} errors={errors}"
  )
  touch_run(state, ok=(errors == 0 and (imported + duplicates) > 0), message=summary)
  save_state(state_path, state)
  result.message = summary
  result.ok = errors == 0 and (imported + duplicates > 0 or result.ok)
  return result, push_results
