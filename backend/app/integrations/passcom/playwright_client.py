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
    # Prima installazione elementi grafici può richiedere diversi minuti
    deadline = time.time() + _env_int("PASSCOM_LOGIN_TIMEOUT_SEC", 420)
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
        # Chiudi dialog + X sessione per liberare lo slot zombie, poi errore
        try:
          self._close_connected_session_ui(page, shots)
        except Exception:
          try:
            page.keyboard.press("Enter")
          except Exception:
            pass
        raise RuntimeError(
          "Passcom: superato il numero massimo di terminali. "
          "Ho chiuso la sessione locale; chiudi altre sessioni Passcom "
          "(browser, iDesk, altri PC) e riprova tra 30–60 secondi."
        )
      if "sessione di lavoro terminata" in body_l:
        self._shot(page, "01_session_terminated", shots)
        raise RuntimeError(
          "Passcom: sessione terminata. Chiudi altre istanze e riprova (ricarica/login pulito)."
        )
      installing = self._is_ui_installing(page)
      title_ok = (
        "Passcom" in title
        or "LAMEDIAZIONE" in title.upper()
        or "Passepartout Passcom" in title
        or ("Passepartout" in title and "Accesso" not in title)
      )
      if title_ok and not installing:
        # Stabilizza: non dichiarare ready se install riparte subito
        if self._wait_ui_ready(page, shots, tag="post_login"):
          self._shot(page, "02_webdesk_ready", shots)
          return True
        # se wait fallisce ma non stiamo installando, prosegui check sotto
      if installing:
        page.wait_for_timeout(3000)
        continue
      # canvas present after connect dialog — solo se install davvero finita
      try:
        if page.locator("canvas").count() > 0 and "Accesso a Passepartout" not in body:
          if self._is_ui_installing(page):
            page.wait_for_timeout(2500)
            continue
          if self._wait_ui_ready(page, shots, tag="canvas"):
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

  def _page_text(self, page: Any, limit: int = 1200) -> str:
    try:
      return page.inner_text("body")[:limit]
    except Exception:
      return ""

  def _is_ui_installing(self, page: Any) -> bool:
    """True mentre Passcom mostra Installazione / Connessione / progress %."""
    text = self._page_text(page, 2000)
    if not text:
      return False
    lower = text.lower()
    if "installazione" in lower:
      return True
    if "elementi grafici" in lower:
      return True
    if "apertura sessione" in lower:
      return True
    # «Connessione…» solo se sembra splash, non testo generico
    if re.search(r"connessione\s*\.{0,3}\s*$", text.strip(), re.I | re.M):
      return True
    if re.search(r"\b([1-9]?\d|100)\s*%", text) and (
      "passepartout" in lower or "install" in lower or "grafici" in lower
    ):
      return True
    return False

  def _wait_ui_ready(self, page: Any, shots: List[str], *, tag: str = "ui") -> bool:
    """
    Attende fine «Installazione elementi grafici…» e UI stabile.
    Può ripartire anche dopo apertura azienda.
    """
    timeout = _env_int("PASSCOM_UI_READY_TIMEOUT_SEC", 360)
    stable_needed = _env_int("PASSCOM_UI_STABLE_POLLS", 3)
    deadline = time.time() + max(60, timeout)
    stable = 0
    last_pct = ""

    while time.time() < deadline:
      text = self._page_text(page, 2000)
      installing = self._is_ui_installing(page)
      m = re.search(r"\b([1-9]?\d|100)\s*%", text or "")
      pct = m.group(0) if m else ""
      if pct and pct != last_pct:
        last_pct = pct
        try:
          self._shot(page, f"02a_{tag}_install_{pct.replace('%', 'pct')}", shots)
        except Exception:
          pass

      if installing:
        stable = 0
        page.wait_for_timeout(2500)
        continue

      # Segnali UI pronta (lista aziende o workspace)
      ready_hint = False
      title = (page.title() or "")
      tlow = text.lower()
      if any(
        s in text
        for s in (
          "Aziende installate",
          "Aziende Installate",
          "Ragione Sociale",
          "Apertura azienda",
          "Docuvision",
          "MENÙ APPLICAZIONE",
          "Menu applicazione",
        )
      ):
        ready_hint = True
      if re.search(r"LA2\s*-\s*\d{2}/\d{2}/\d{4}", text):
        ready_hint = True
      if "MEDIAZIONE" in title.upper() or "Passcom Live" in title:
        ready_hint = True
      if "accesso a passepartout" in tlow and "dominio" in tlow:
        # Tornati al login → non «ready» per lavoro
        return False

      try:
        has_canvas = page.locator("canvas").count() > 0
      except Exception:
        has_canvas = False

      if has_canvas or ready_hint:
        stable += 1
        if stable >= stable_needed:
          self._shot(page, f"02a_{tag}_ready", shots)
          page.wait_for_timeout(800)
          return True
      else:
        stable = 0
      page.wait_for_timeout(2000)

    self._shot(page, f"02a_{tag}_ready_timeout", shots)
    return not self._is_ui_installing(page)

  def _dismiss_popups(self, page: Any) -> None:
    """Chiude dialoghi errore (Chiudi/Ok) senza navigare altrove."""
    text = self._page_text(page)
    if not text:
      return
    lower = text.lower()
    if any(
      s in lower
      for s in (
        "voce di menu",
        "cancellata o disabilitata",
        "accesso non possibile",
        "analisi dati",
      )
    ):
      # Ok / Chiudi tipicamente in basso a destra del dialog
      for _ in range(2):
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
      page.keyboard.press("Enter")
      page.wait_for_timeout(400)
      # click Chiudi dialog (~centro-basso)
      page.mouse.click(640, 430)
      page.wait_for_timeout(400)

  def _ensure_azienda_aperta(self, page: Any, shots: List[str]) -> bool:
    """
    Dopo login spesso si resta su «Aziende installate» con dialog «Apertura azienda».
    Conferma Ok / Apri azienda nell'ultimo anno e aspetta l'azienda aperta.
    """
    # Non cliccare durante «Installazione elementi grafici…»
    if not self._wait_ui_ready(page, shots, tag="pre_azienda"):
      self._shot(page, "02b_ui_not_ready", shots)
      # riprova comunque se non sta più installando
      if self._is_ui_installing(page):
        return False

    self._focus_canvas(page)
    page.wait_for_timeout(800)
    self._dismiss_popups(page)
    self._shot(page, "02b_before_open_azienda", shots)

    text = self._page_text(page)
    title = page.title() or ""

    already_open = (
      "MEDIAZIONE" in title.upper()
      and "Aziende Installate" not in text
      and "Apertura azienda" not in text
    )
    if already_open and "Aziende installate" not in text.lower() and not self._is_ui_installing(page):
      self._shot(page, "02c_azienda_already_open", shots)
      return True

    # Se lista aziende: apri l'ultima (bottone in basso a destra)
    if "Aziende installate" in text or "Aziende Installate" in text or "Ragione Sociale" in text:
      # Click riga azienda selezionata (centro lista)
      page.mouse.click(_env_int("PASSCOM_CLICK_AZIENDA_ROW_X", 520), _env_int("PASSCOM_CLICK_AZIENDA_ROW_Y", 260))
      page.wait_for_timeout(300)
      # «Apri azienda nell'ultimo anno» — tipico bottom-right toolbar
      page.mouse.click(
        _env_int("PASSCOM_CLICK_APRI_ULTIMO_ANNO_X", 980),
        _env_int("PASSCOM_CLICK_APRI_ULTIMO_ANNO_Y", 760),
      )
      page.wait_for_timeout(1000)
      self._shot(page, "02d_after_apri_ultimo_anno", shots)

    text = self._page_text(page)
    # Dialog Apertura azienda: Ok è in evidenza → Enter
    if "Apertura azienda" in text or "Data di apertura" in text or "Anni gestiti" in text:
      self._shot(page, "02e_apertura_dialog", shots)
      page.keyboard.press("Enter")
      page.wait_for_timeout(800)
      # fallback click Ok dialog
      page.mouse.click(
        _env_int("PASSCOM_CLICK_APERTURA_OK_X", 720),
        _env_int("PASSCOM_CLICK_APERTURA_OK_Y", 500),
      )
      page.wait_for_timeout(1500)
      self._dismiss_popups(page)
      self._shot(page, "02f_after_apertura_ok", shots)

    # Dopo Ok l'installazione grafica può ripartire: aspetta di nuovo
    self._wait_ui_ready(page, shots, tag="post_apertura")

    # Attendi chiusura dialog / ingresso azienda
    deadline = time.time() + 120
    while time.time() < deadline:
      if self._is_ui_installing(page):
        page.wait_for_timeout(2500)
        continue
      self._dismiss_popups(page)
      text = self._page_text(page)
      title = page.title() or ""
      if "Apertura azienda" in text:
        page.keyboard.press("Enter")
        page.wait_for_timeout(1000)
        continue
      if "numero massimo di terminali" in text.lower():
        raise RuntimeError(
          "Passcom: superato il numero massimo di terminali durante apertura azienda."
        )
      opened = (
        ("MEDIAZIONE" in title.upper() or "LA2" in title.upper() or "Passcom Live" in title)
        and "Aziende Installate" not in text
        and "Apertura azienda" not in text
      )
      # Tab azienda aperta tipico: "LA2 - gg/mm/aaaa ..."
      if opened or re.search(r"LA2\s*-\s*\d{2}/\d{2}/\d{4}", text):
        # Se ancora lista aziende in primo piano, non ok
        if "Ragione Sociale" in text and "Aziende installate" in text.lower():
          page.wait_for_timeout(1500)
          continue
        self._shot(page, "02g_azienda_open", shots)
        # Ultima stabilizzazione prima dei menu
        self._wait_ui_ready(page, shots, tag="azienda_open")
        page.wait_for_timeout(1000)
        return True
      page.wait_for_timeout(1500)

    self._shot(page, "02h_azienda_open_timeout", shots)
    # Prosegui comunque solo se UI non sta installando
    return not self._is_ui_installing(page)

  def _open_azienda_menu(self, page: Any) -> None:
    """Apre menu Azienda (click barra + Alt+A)."""
    self._dismiss_popups(page)
    self._focus_canvas(page)
    page.wait_for_timeout(300)
    page.keyboard.press("Alt+KeyA")
    page.wait_for_timeout(400)
    page.mouse.click(70, 55)
    page.wait_for_timeout(400)

  def _navigate_to_fatture_ricevute(self, page: Any, shots: List[str]) -> bool:
    """
    Dopo azienda aperta: Azienda → Docuvision → Fatture elettroniche → Fatture ricevute.
    """
    if self._is_ui_installing(page) or not self._wait_ui_ready(page, shots, tag="pre_nav"):
      self._shot(page, "03_nav_blocked_installing", shots)
      return False

    self._dismiss_popups(page)
    self._open_azienda_menu(page)
    self._shot(page, "03_azienda_menu", shots)

    # Voci tipiche: Apertura, Anagrafica, Chiusura, ..., Docuvision (~7°)
    for _ in range(7):
      page.keyboard.press("ArrowDown")
      page.wait_for_timeout(140)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(500)
    self._shot(page, "04_docuvision_submenu", shots)

    # Nel submenu Docuvision cerca Fatture elettroniche / ricevute
    for _ in range(8):
      page.keyboard.press("ArrowDown")
      page.wait_for_timeout(120)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    for _ in range(4):
      page.keyboard.press("ArrowDown")
      page.wait_for_timeout(120)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    self._shot(page, "05_fatture_path_enter", shots)

    # Coordinate opzionali se calibrate
    doc_x, doc_y = _env("PASSCOM_CLICK_DOCUVISION_X"), _env("PASSCOM_CLICK_DOCUVISION_Y")
    if doc_x and doc_y:
      self._open_azienda_menu(page)
      page.mouse.click(int(doc_x), int(doc_y))
      page.wait_for_timeout(600)
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

  def _try_export_xml(self, page: Any, shots: List[str]) -> None:
    """
    Tenta export/download XML dalla lista fatture ricevute.
    Azioni tipiche: seleziona riga, Esporta / Salva / Shift+F10.
    """
    before = len(self._xml_captures)
    self._dismiss_popups(page)

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

  def _close_connected_session_ui(self, page: Any, shots: List[str]) -> None:
    """
    Chiude la sessione Passcom Live dalla barra (X / sessioni connesse).
    Necessario quando c'è il dialog max terminali ma la shell è già aperta.
    """
    try:
      text = self._page_text(page).lower()
    except Exception:
      text = ""

    # OK sul dialog «Superato il numero massimo di terminali»
    if "numero massimo" in text or "accesso non possibile" in text:
      try:
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
      except Exception:
        pass
      # click tipico sul bottone OK del dialog (centro)
      try:
        page.mouse.click(
          _env_int("PASSCOM_CLICK_MAXTERM_OK_X", 640),
          _env_int("PASSCOM_CLICK_MAXTERM_OK_Y", 420),
        )
        page.wait_for_timeout(600)
      except Exception:
        pass

    # X chiusura sessione in alto a destra (accanto a «sessioni connesse»)
    for x, y in (
      (_env_int("PASSCOM_CLICK_SESSION_CLOSE_X", 1255), _env_int("PASSCOM_CLICK_SESSION_CLOSE_Y", 14)),
      (1248, 12),
      (1265, 16),
      (1230, 14),
      (1205, 14),
    ):
      try:
        page.mouse.click(x, y)
        page.wait_for_timeout(500)
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
      except Exception:
        continue

    # Click su «sessioni connesse» poi elimina/chiudi
    try:
      page.mouse.click(
        _env_int("PASSCOM_CLICK_SESSIONI_X", 1180),
        _env_int("PASSCOM_CLICK_SESSIONI_Y", 14),
      )
      page.wait_for_timeout(600)
      page.keyboard.press("Delete")
      page.wait_for_timeout(300)
      page.keyboard.press("Enter")
      page.wait_for_timeout(500)
    except Exception:
      pass

    try:
      self._shot(page, "90b_after_session_close", shots)
    except Exception:
      pass

  def _logout_session(self, page: Any, shots: List[str]) -> None:
    """
    Chiude sempre la sessione Passcom (successo o errore).
    Senza logout esplicito il terminale resta occupato sul server.
    """
    try:
      self._shot(page, "90_before_logout", shots)
    except Exception:
      pass

    try:
      self._dismiss_popups(page)
    except Exception:
      pass

    # Prima chiudi dialog max-terminali + X sessione (libera lo slot)
    try:
      self._close_connected_session_ui(page, shots)
    except Exception:
      pass

    # Conferma eventuali dialog residui
    try:
      text = self._page_text(page).lower()
      if "accesso non possibile" in text or "numero massimo" in text or "chiudi" in text:
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    except Exception:
      pass

    # Se siamo ancora sulla form di login senza canvas, niente sessione da chiudere
    try:
      body = self._page_text(page)
      title = page.title() or ""
      has_canvas = False
      try:
        has_canvas = page.locator("canvas").count() > 0
      except Exception:
        pass
      on_login_form = (
        ("Accesso a Passepartout" in body or "Accesso a Passepartout" in title)
        and not has_canvas
      )
      if on_login_form:
        return
    except Exception:
      pass

    # 1) Menu File → Uscita (tipico Mexal/Passcom) + scorciatoie soft
    for attempt in (
      "Control+Q",
      "Alt+KeyF",
    ):
      try:
        self._focus_canvas(page)
        page.keyboard.press(attempt)
        page.wait_for_timeout(400)
        if attempt == "Alt+KeyF":
          for _ in range(12):
            page.keyboard.press("ArrowUp")
            page.wait_for_timeout(60)
          page.keyboard.press("Enter")
          page.wait_for_timeout(400)
        for _ in range(3):
          page.keyboard.press("Enter")
          page.wait_for_timeout(350)
      except Exception:
        continue

    # 2) Click icone tipiche Uscita / Disconnetti (barra in alto a destra)
    for x, y in (
      (_env_int("PASSCOM_CLICK_LOGOUT_X", 1240), _env_int("PASSCOM_CLICK_LOGOUT_Y", 20)),
      (1200, 18),
      (1260, 40),
      (1100, 20),
    ):
      try:
        page.mouse.click(x, y)
        page.wait_for_timeout(400)
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
      except Exception:
        continue

    # 3) Menu Azienda → Chiusura azienda, poi uscita sessione
    try:
      self._open_azienda_menu(page)
      # Chiusura spesso in fondo / vicino ad Apertura
      page.keyboard.press("ArrowDown")
      page.wait_for_timeout(100)
      page.keyboard.press("ArrowDown")
      page.wait_for_timeout(100)
      page.keyboard.press("Enter")
      page.wait_for_timeout(600)
      for _ in range(2):
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
    except Exception:
      pass

    # 4) Naviga alla URL di login / disconnect se ancora in sessione
    try:
      text = self._page_text(page).lower()
      title = (page.title() or "").lower()
      still_in = (
        "passcom" in title
        or "passepartout" in title
        or "mediazione" in title
        or page.locator("canvas").count() > 0
      )
      if still_in and "accesso a passepartout" not in text:
        # Alcuni WebDesk espongono logout via query
        base = self.base_url.split("?")[0].rstrip("/")
        for url in (
          f"{base}?logout=1",
          f"{base}/logout",
          self.base_url,
        ):
          try:
            page.goto(url, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(800)
          except Exception:
            continue
          break
    except Exception:
      pass

    try:
      self._shot(page, "91_after_logout", shots)
    except Exception:
      pass

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
    """Login → navigazione → collect XML bytes. Logout sempre in uscita."""
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
    result: Optional[PasscomSyncResult] = None

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
          result = PasscomSyncResult(
            ok=False,
            message="Login Passcom fallito (credenziali, UA o timeout WebDesk)",
            screenshots=shots,
            login_ok=False,
          )
        else:
          # Attendi UI pronta (installazione grafica), apri azienda, poi Docuvision
          self._wait_ui_ready(page, shots, tag="pre_work")
          azienda_ok = self._ensure_azienda_aperta(page, shots)
          navigated = False
          if azienda_ok:
            if self._wait_ui_ready(page, shots, tag="pre_docuvision"):
              navigated = self._navigate_to_fatture_ricevute(page, shots)
              if navigated and not self._is_ui_installing(page):
                self._try_export_xml(page, shots)
          self._sweep_drop_dir()

          msg = (
            f"Login OK; azienda={'ok' if azienda_ok else 'ko'}; "
            f"navigazione={'ok' if navigated else 'parziale'}; "
            f"XML catturati={len(self._xml_captures)}"
          )
          if not self._xml_captures:
            msg += (
              ". Nessun XML scaricato: calibra PASSCOM_CLICK_* o esporta in PASSCOM_XML_DROP_DIR "
              f"(screenshot in {self.debug_dir})"
            )

          result = PasscomSyncResult(
            ok=True if self._xml_captures else False,
            message=msg,
            downloaded=list(self._xml_captures),
            screenshots=shots,
            login_ok=login_ok,
            navigated=navigated,
          )
      except Exception as e:
        self._shot(page, "99_exception", shots)
        result = PasscomSyncResult(
          ok=False,
          message=f"Errore Passcom Playwright: {e}",
          downloaded=list(self._xml_captures),
          screenshots=shots,
          login_ok=login_ok,
          navigated=navigated,
        )
      finally:
        # Sempre logout (anche se login fallito a metà / eccezione), poi chiudi browser
        try:
          self._logout_session(page, shots)
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
      result = PasscomSyncResult(
        ok=False,
        message="Sessione Passcom interrotta senza risultato",
        screenshots=shots,
        login_ok=login_ok,
        navigated=navigated,
      )
    # Aggiorna screenshot list (logout ne aggiunge)
    result.screenshots = shots
    if "logout" not in result.message.lower():
      result.message = f"{result.message} | logout eseguito"
    return result


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
