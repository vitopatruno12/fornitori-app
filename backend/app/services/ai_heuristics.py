import re
import unicodedata
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple


_KEYWORD_TOKENS = (
    "partita iva", "p.iva", "p iva", "piva", "iva",
    "codice fiscale", "cod. fisc", "cf",
    "email", "e-mail", "e mail", "pec",
    "telefono", "cell", "cellulare", "tel",
    "citta", "città", "city",
    "indirizzo", "via", "piazza", "viale", "corso", "strada",
    "iban",
    "referente", "responsabile", "contatto", "persona",
    "pagamento", "pagamenti", "bonifico", "rid", "ricevuta",
    "categoria", "merce", "merceologica", "settore",
    "note", "nota",
)


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _normalize_for_match(s: str) -> str:
    return re.sub(r"\s+", " ", _strip_accents((s or "").lower())).strip()


def _split_sentences(t: str) -> List[str]:
    parts = re.split(r"[\n;]+|(?:,\s+(?=(?:partita|p\.?\s?iva|piva|email|e-?mail|tel|cell|telefono|citta|città|indirizzo|iban|pec|referente|note|categoria|pagamento|bonifico)))", t, flags=re.I)
    return [p.strip(" ,;.\t") for p in parts if p and p.strip(" ,;.\t")]


def _find_first_keyword_index(t: str) -> int:
    lo = _normalize_for_match(t)
    indices: List[int] = []
    for k in _KEYWORD_TOKENS:
        i = lo.find(k)
        if i >= 0:
            indices.append(i)
    return min(indices) if indices else -1


def _extract_name(t: str) -> str:
    if not t:
        return ""
    cut = _find_first_keyword_index(t)
    candidate = t if cut < 0 else t[:cut]
    candidate = candidate.split(",")[0].split("\n")[0].strip(" ,;.-")
    if 2 <= len(candidate) <= 80:
        return candidate
    return ""


_DAY_WORDS = {
    "lunedi": 0, "martedi": 1, "mercoledi": 2, "giovedi": 3, "venerdi": 4, "sabato": 5, "domenica": 6,
}


def _parse_date_token(tok: str, today: Optional[datetime] = None) -> Optional[str]:
    """Parse natural date token (oggi, domani, lunedi, 15/03, 15/03/2026...)"""
    if not tok:
        return None
    t = _normalize_for_match(tok)
    today = today or datetime.now()
    if t in ("oggi", "stesso giorno"):
        return today.date().isoformat()
    if t == "domani":
        return (today + timedelta(days=1)).date().isoformat()
    if t == "dopodomani":
        return (today + timedelta(days=2)).date().isoformat()
    for word, dow in _DAY_WORDS.items():
        if word in t:
            delta = (dow - today.weekday()) % 7
            if delta == 0:
                delta = 7
            return (today + timedelta(days=delta)).date().isoformat()
    m = re.search(r"\b([0-3]?\d)\s*[/\-\.]\s*([0-1]?\d)(?:\s*[/\-\.]\s*(\d{2,4}))?\b", t)
    if m:
        dd, mm = int(m.group(1)), int(m.group(2))
        yy = m.group(3)
        year = today.year
        if yy:
            yy = int(yy)
            year = yy + 2000 if yy < 100 else yy
        try:
            return datetime(year, mm, dd).date().isoformat()
        except Exception:
            return None
    return None


def _detect_payment_terms(lo: str) -> Optional[str]:
    m = re.search(r"(?:pagament[oi]|condizioni)\s*[:\s]*([^,;\n]{2,80})", lo, re.I)
    if m:
        return m.group(1).strip()
    if "bonifico" in lo and "30" in lo and ("giorni" in lo or "gg" in lo):
        return "Bonifico 30 giorni"
    if "bonifico" in lo and "60" in lo and ("giorni" in lo or "gg" in lo):
        return "Bonifico 60 giorni"
    if "bonifico" in lo:
        return "Bonifico"
    if "rid" in lo:
        return "RID"
    if "ricevuta bancaria" in lo or "ri.ba" in lo:
        return "Ricevuta bancaria"
    if "contanti" in lo or "contante" in lo:
        return "Contanti"
    return None


def suggest_supplier_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    t = (text or "").strip()
    if not t:
        current = existing_data or {}
        return {"suggested_fields": {}, "missing_fields": ["name"], "warnings": [], "confidence": 0.0}
    lo = t.lower()
    lo_norm = _normalize_for_match(t)
    out: Dict[str, Any] = {}

    name = _extract_name(t)
    if name:
        out["name"] = name

    m_vat = re.search(r"(?:partita\s*iva|p\.?\s*iva|piva)\s*[:\s]*(?:it\s*)?([0-9][0-9\s]{8,13})", lo, re.I)
    if m_vat:
        out["vat_number"] = re.sub(r"\s+", "", m_vat.group(1))[-11:]
    elif "iva" not in lo_norm:
        m_just = re.search(r"\b(\d{11})\b", t)
        if m_just:
            out["vat_number"] = m_just.group(1)

    m_cf = re.search(r"(?:codice\s*fiscale|cod\.?\s*fisc\.?|c\.?f\.?)\s*[:\s]*([A-Z0-9]{11,16})", t, re.I)
    if m_cf:
        out["fiscal_code"] = m_cf.group(1).upper()
    else:
        m_cf2 = re.search(r"\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b", t.upper())
        if m_cf2:
            out["fiscal_code"] = m_cf2.group(1)

    m_email = re.search(r"([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})", lo, re.I)
    if m_email:
        out["email"] = m_email.group(1)

    m_phone = re.search(r"(?:telefono|tel\.?|cellulare|cell\.?)\s*[:\s]*([0-9+][0-9+\s\-/.]{6,20})", t, re.I)
    if m_phone:
        out["phone"] = re.sub(r"[^\d+]", "", m_phone.group(1))[:15]
    else:
        m_phone2 = re.search(r"\b((?:\+?39\s?)?[03][0-9](?:[\s\-.]?\d){7,10})\b", t)
        if m_phone2:
            out["phone"] = re.sub(r"[^\d+]", "", m_phone2.group(1))[:15]

    m_city = re.search(r"(?:citt[aà]|city)\s*[:\s]*([a-zA-ZàèéìòùÀÈÉÌÒÙ'\s]{2,50})", t, re.I)
    if m_city:
        out["city"] = re.split(r"[,;\n]", m_city.group(1))[0].strip()

    m_addr = re.search(r"(?:indirizzo)\s*[:\s]*([^,;\n]{4,120})", t, re.I)
    if m_addr:
        out["address"] = m_addr.group(1).strip()
    else:
        m_addr2 = re.search(r"\b(?:via|piazza|viale|corso|strada)\s+([A-Za-zÀ-ÿ0-9' .]{3,80}?)(?=,|;|$|\s+(?:partita|piva|email|tel|cell))", t, re.I)
        if m_addr2:
            out["address"] = (m_addr2.group(0)).strip().rstrip(",;.")

    m_iban = re.search(r"\b(?:iban\s*[:\s]*)?([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b", t.upper())
    if m_iban:
        cand = m_iban.group(1)
        if cand.startswith(("IT", "SM", "VA", "DE", "FR", "ES", "GB", "CH", "AT", "BE", "NL")):
            out["iban"] = cand

    m_ref = re.search(r"(?:referente|responsabile|contatto|persona)\s*[:\s]*([A-Za-zÀ-ÿ' .]{3,60})", t, re.I)
    if m_ref:
        out["contact_person"] = re.split(r"[,;\n]", m_ref.group(1))[0].strip()

    pt = _detect_payment_terms(lo)
    if pt:
        out["payment_terms"] = pt

    m_notes = re.search(r"(?:^|[,;\n])\s*note?\s*[:\s]*([^\n;]{2,500})", t, re.I)
    if m_notes:
        out["notes"] = m_notes.group(1).strip()

    category = "altro"
    if any(k in lo for k in ["bevande", "acqua", "vino", "birra", "bibita"]):
        category = "bevande"
    elif any(k in lo for k in ["ortofrutta", "frutta", "verdura", "ortaggi"]):
        category = "ortofrutta"
    elif any(k in lo for k in ["carne", "macelleria", "salumi", "salumeria"]):
        category = "carne"
    elif any(k in lo for k in ["pesce", "pescheria", "ittico"]):
        category = "pesce"
    elif any(k in lo for k in ["panificio", "pane", "panetteria", "pasticceria", "dolci"]):
        category = "panificio"
    elif any(k in lo for k in ["luce", "gas", "acquedotto", "energia", "utenze"]):
        category = "utenze"
    elif "manutenzione" in lo:
        category = "manutenzione"
    out["merchandise_category"] = category

    current = existing_data or {}
    merged = {**current, **out}
    missing = [k for k in ["name", "vat_number", "iban", "email", "payment_terms"] if not str(merged.get(k) or "").strip()]
    warnings: List[str] = []
    if "pec" not in lo:
        warnings.append("PEC non rilevata nel testo")
    if not out.get("name") and not current.get("name"):
        warnings.append("Ragione sociale non rilevata")
    confidence = round(min(0.99, 0.55 + 0.07 * len([k for k in out if k != "merchandise_category"])), 2)
    return {
        "suggested_fields": out,
        "missing_fields": missing,
        "warnings": warnings,
        "confidence": confidence,
    }


def suggest_prima_nota_fields(text: str) -> Dict[str, Any]:
    t = (text or "").strip()
    lo = t.lower()
    out: Dict[str, Any] = {"description": t}
    m_amount = re.search(r"([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:euro|€)?", lo)
    if m_amount:
        out["amount"] = float(m_amount.group(1).replace(",", "."))

    out["type"] = "uscita" if any(k in lo for k in ["pagato", "uscita", "acquisto", "spesa"]) else "entrata"
    out["payment_method_hint"] = "bonifico" if "bonifico" in lo else ("contanti" if "contanti" in lo else None)
    out["account_hint"] = "BANCA" if "bonifico" in lo or "banca" in lo else "CASSA"

    cat = "spese_generali"
    if any(k in lo for k in ["acqua", "luce", "gas", "utenza"]):
        cat = "utenze"
    elif any(k in lo for k in ["bevande", "vino", "birra"]):
        cat = "bevande"
    elif "manutenzione" in lo:
        cat = "manutenzione"
    out["category_hint"] = cat

    if "30 giorni" in lo:
        out["due_hint"] = (datetime.now() + timedelta(days=30)).date().isoformat()

    return {"suggested_fields": out, "warnings": [], "confidence": 0.9}


def suggest_invoice_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    t = (text or "").strip()
    lo = t.lower()
    out: Dict[str, Any] = {}
    warnings: List[str] = []

    m_total = re.search(r"(?:totale|importo)\s*[:\s]*([0-9]+(?:[.,][0-9]{1,2})?)", lo, re.I)
    if m_total:
        out["imponibile_hint"] = round(float(m_total.group(1).replace(",", ".")) / 1.22, 2)
        out["total_hint"] = float(m_total.group(1).replace(",", "."))
    else:
        m_any = re.search(r"([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:euro|€)", lo)
        if m_any:
            out["imponibile_hint"] = round(float(m_any.group(1).replace(",", ".")) / 1.22, 2)

    m_date = re.search(r"(?:del|data)\s*([0-3]?\d[/-][0-1]?\d[/-]\d{2,4})", lo)
    if m_date:
        raw = m_date.group(1).replace("-", "/")
        dd, mm, yy = raw.split("/")
        if len(yy) == 2:
            yy = f"20{yy}"
        try:
            dt = datetime(int(yy), int(mm), int(dd))
            out["invoice_date_hint"] = dt.date().isoformat()
            out["due_date_hint"] = (dt + timedelta(days=30)).date().isoformat()
        except Exception:
            warnings.append("Data non interpretabile con certezza")

    category = "spese_generali"
    if any(k in lo for k in ["bevande", "acqua", "vino", "birra"]):
        category = "bevande"
    elif any(k in lo for k in ["luce", "gas", "acquedotto", "energia"]):
        category = "utenze"
    elif "manutenzione" in lo:
        category = "manutenzione"
    out["category_hint"] = category

    if "bonifico" in lo:
        out["payment_method_hint"] = "bonifico"
    elif "contanti" in lo or "cassa" in lo:
        out["payment_method_hint"] = "contanti"

    current = existing_data or {}
    if not (current.get("invoice_number") or re.search(r"(?:fattura|doc\.?|numero)\s*[:\s#-]*([a-z0-9\/\-]+)", lo, re.I)):
        warnings.append("Numero fattura non rilevato")
    if not (current.get("due_date") or out.get("due_date_hint")):
        warnings.append("Data scadenza da verificare")

    return {"suggested_fields": out, "warnings": warnings, "confidence": 0.84}


def _match_supplier_name(text: str, supplier_names: List[str]) -> Optional[Tuple[str, float]]:
    if not text or not supplier_names:
        return None
    norm_text = _normalize_for_match(text)
    best: Optional[Tuple[str, float]] = None
    for name in supplier_names:
        n_norm = _normalize_for_match(name)
        if not n_norm:
            continue
        if n_norm in norm_text:
            score = min(1.0, 0.6 + 0.05 * len(n_norm.split()))
            if best is None or score > best[1]:
                best = (name, score)
            continue
        words = [w for w in re.split(r"\s+", n_norm) if len(w) > 2]
        if not words:
            continue
        hits = sum(1 for w in words if w in norm_text)
        if hits >= max(1, len(words) - 1):
            score = 0.45 + 0.1 * hits
            if best is None or score > best[1]:
                best = (name, score)
    return best


def _strip_known_dates(t: str) -> str:
    """Remove date and date-keyword fragments from text (used to leave product lines untouched)."""
    out = t
    for pat in [
        r"data\s+ordine\s*[:\s]*[^\n,;]*",
        r"consegna(?:\s+prevista)?\s*[:\s]*[^\n,;]*",
        r"data\s+consegna\s*[:\s]*[^\n,;]*",
    ]:
        out = re.sub(pat, " ", out, flags=re.I)
    return out


def suggest_order_full(text: str, supplier_names: Optional[List[str]] = None) -> Dict[str, Any]:
    """Comprehensive order parsing: supplier match, dates, destination, signatures, lines, notes."""
    t = (text or "").strip()
    warnings: List[str] = []
    out: Dict[str, Any] = {}
    if not t:
        return {
            "suggested_fields": {},
            "suggested_lines": [],
            "warnings": ["Testo vuoto"],
            "confidence": 0.0,
        }
    lo = t.lower()
    lo_norm = _normalize_for_match(t)

    if supplier_names:
        m = _match_supplier_name(t, supplier_names)
        if m:
            out["supplier_name"] = m[0]
            out["supplier_match_confidence"] = round(m[1], 2)

    m_od = re.search(r"data\s+ordine\s*[:\s]*([^\n,;]+)", t, re.I)
    if m_od:
        d = _parse_date_token(m_od.group(1))
        if d:
            out["order_date"] = d
    elif "oggi" in lo_norm.split() or "oggi," in lo_norm or " oggi " in f" {lo_norm} ":
        out["order_date"] = datetime.now().date().isoformat()

    m_ed = re.search(r"(?:consegna(?:\s+prevista)?|data\s+consegna)\s*[:\s]*([^\n,;]+)", t, re.I)
    if m_ed:
        d = _parse_date_token(m_ed.group(1))
        if d:
            out["expected_delivery_date"] = d

    m_dest = re.search(r"(?:destinazione|consegnare\s+(?:a|presso)|scarico\s+(?:a|presso)|spedizione\s+(?:a|presso))\s*[:\s]*([^\n;]{2,200})", t, re.I)
    if m_dest:
        dest = re.split(r"\b(?:firma|note|prodott|riga|pagament|piva|p\.iva|partita\s+iva)\b", m_dest.group(1), maxsplit=1, flags=re.I)[0]
        out["delivery_location"] = dest.strip(" ,;:.-")[:128]

    m_signed_by = re.search(r"(?:firma\s+ordine|ordinato\s+da|chi\s+ordina)\s*[:\s]*([A-Za-zÀ-ÿ' .]{2,60})", t, re.I)
    if m_signed_by:
        out["order_signed_by"] = re.split(r"[,;\n]", m_signed_by.group(1))[0].strip()

    m_unl = re.search(r"(?:firma\s+scarico|scarica(?:to)?\s+da|chi\s+scarica)\s*[:\s]*([A-Za-zÀ-ÿ' .]{2,60})", t, re.I)
    if m_unl:
        out["unloading_signed_by"] = re.split(r"[,;\n]", m_unl.group(1))[0].strip()

    m_vat = re.search(r"\biva\s*(?:al)?\s*([0-9]{1,2})\s*%", lo, re.I)
    if m_vat:
        try:
            out["vat_percent"] = int(m_vat.group(1))
        except (TypeError, ValueError):
            pass

    m_note = re.search(r"(?:^|[,;\n])\s*note?\s*[:\s]*([^\n;]{2,500})", t, re.I)
    if m_note:
        out["note"] = m_note.group(1).strip()

    products_text = t
    m_prods = re.search(r"prodott[oi]?\s*[:\s]*(.+)$", t, re.I | re.S)
    if m_prods:
        products_text = m_prods.group(1)
    products_text = _strip_known_dates(products_text)
    for pat in [
        r"destinazione\s*[:\s]*[^\n,;]*",
        r"firma\s+(?:ordine|scarico)\s*[:\s]*[^\n,;]*",
        r"ordinato\s+da\s*[:\s]*[^\n,;]*",
        r"^note?\s*[:\s]*[^\n;]*",
        r"iva\s*(?:al)?\s*\d{1,2}\s*%",
    ]:
        products_text = re.sub(pat, " ", products_text, flags=re.I | re.M)

    lines_result = suggest_order_lines(products_text)
    suggested_lines = lines_result.get("suggested_lines") or []

    if not suggested_lines:
        warnings.append("Nessuna riga prodotto ricavata dal testo")
    if supplier_names and not out.get("supplier_name"):
        warnings.append("Fornitore non riconosciuto: selezionalo manualmente")

    confidence = round(min(0.99, 0.45 + 0.07 * len(out) + 0.05 * min(8, len(suggested_lines))), 2)
    return {
        "suggested_fields": out,
        "suggested_lines": suggested_lines,
        "warnings": warnings,
        "confidence": confidence,
    }


def suggest_order_lines(text: str) -> Dict[str, Any]:
    """Estrae righe ordine da testo libero (una riga per voce, anche separate da ;)."""
    t = (text or "").strip()
    warnings: List[str] = []
    lines_out: List[Dict[str, Any]] = []
    chunks = re.split(r"[\n;]+", t)
    for raw in chunks:
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"^(\d+(?:[.,]\d+)?)\s*kg\s+(.+)$", line, re.I)
        if m:
            w = float(m.group(1).replace(",", "."))
            lines_out.append(
                {
                    "product_description": m.group(2).strip(),
                    "pieces": None,
                    "weight_kg": w,
                    "note": None,
                }
            )
            continue
        m = re.match(r"^(.+?)\s+(\d+(?:[.,]\d+)?)\s*kg$", line, re.I)
        if m and len(m.group(1).strip()) >= 2:
            w = float(m.group(2).replace(",", "."))
            lines_out.append(
                {
                    "product_description": m.group(1).strip(),
                    "pieces": None,
                    "weight_kg": w,
                    "note": None,
                }
            )
            continue
        m = re.match(r"^(\d+)\s*[x×]\s*(.+)$", line, re.I)
        if m:
            lines_out.append(
                {
                    "product_description": m.group(2).strip(),
                    "pieces": int(m.group(1)),
                    "weight_kg": None,
                    "note": None,
                }
            )
            continue
        m = re.match(r"^(\d+)\s+(.{3,})$", line)
        if m:
            lines_out.append(
                {
                    "product_description": m.group(2).strip(),
                    "pieces": int(m.group(1)),
                    "weight_kg": None,
                    "note": None,
                }
            )
            continue
        m = re.match(r"^(.+?)\s+(\d+)\s*(?:pz|pezzi)?$", line, re.I)
        if m and len(m.group(1).strip()) >= 2:
            lines_out.append(
                {
                    "product_description": m.group(1).strip(),
                    "pieces": int(m.group(2)),
                    "weight_kg": None,
                    "note": None,
                }
            )
            continue
        lines_out.append({"product_description": line, "pieces": None, "weight_kg": None, "note": None})
    if not lines_out:
        warnings.append("Nessuna riga ricavata dal testo")
    return {"suggested_lines": lines_out, "warnings": warnings, "confidence": 0.74}


def check_anomalies(entity_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    typ = (entity_type or "").lower()
    anomalies: List[str] = []
    if typ == "invoice":
        imponibile = float(payload.get("imponibile") or 0)
        iva = float(payload.get("vat_amount") or payload.get("iva") or 0)
        totale = float(payload.get("total") or payload.get("totale") or 0)
        if round(imponibile + iva, 2) != round(totale, 2):
            anomalies.append("Totale non coerente con imponibile + IVA")
        if not payload.get("due_date"):
            anomalies.append("Data scadenza mancante")
    if typ == "supplier":
        if not str(payload.get("vat_number") or "").strip():
            anomalies.append("Partita IVA mancante")
        if not str(payload.get("email") or "").strip():
            anomalies.append("Email mancante")
        if not str(payload.get("payment_terms") or "").strip():
            anomalies.append("Condizioni di pagamento mancanti")
    if typ in ("prima-nota", "prima_nota", "cash"):
        if not str(payload.get("description") or "").strip():
            anomalies.append("Descrizione movimento mancante")
        amount = float(payload.get("amount") or 0)
        if amount <= 0:
            anomalies.append("Importo non valido")
        if not payload.get("category_id"):
            anomalies.append("Categoria non impostata")
        if not payload.get("payment_method_id"):
            anomalies.append("Metodo pagamento non impostato")
    if typ in ("supplier-order", "supplier_order"):
        sid = payload.get("supplier_id")
        if sid is None or (isinstance(sid, (int, float)) and int(sid) <= 0):
            anomalies.append("Fornitore non selezionato")
        items = payload.get("items") or []
        if not items:
            anomalies.append("Nessuna riga merce")
        seen: set = set()
        for it in items:
            d = str((it or {}).get("product_description") or "").strip().lower()
            if not d:
                anomalies.append("Riga senza descrizione prodotto")
                continue
            if d in seen:
                anomalies.append(f"Prodotto duplicato nell'ordine: {d}")
            seen.add(d)
            pc = (it or {}).get("pieces")
            if pc is not None:
                try:
                    if int(pc) < 0:
                        anomalies.append("Quantità negativa su una riga")
                except (TypeError, ValueError):
                    anomalies.append("Quantità non numerica su una riga")
            wkg = (it or {}).get("weight_kg")
            if wkg is not None:
                try:
                    if float(wkg) < 0:
                        anomalies.append("Peso (kg) negativo su una riga")
                except (TypeError, ValueError):
                    anomalies.append("Peso (kg) non numerico su una riga")
        od = payload.get("order_date")
        ed = payload.get("expected_delivery_date")
        if od and ed and str(ed) < str(od):
            anomalies.append("Data consegna prevista precedente alla data ordine")
    severity = "low" if len(anomalies) <= 1 else "medium"
    return {"has_anomalies": len(anomalies) > 0, "anomalies": anomalies, "severity": severity}


def ask_ai(question: str, module: str | None = None, context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    q = (question or "").lower().strip()
    mod = (module or "").lower().strip()
    _ = context or {}

    if any(k in q for k in ["scadut", "scadenz", "in scadenza", "ritardo"]):
        actions = ["open_invoices"]
        if "in scadenza" in q:
            actions.append("filter_due_soon")
        else:
            actions.append("filter_overdue")
        return {
            "answer": "Ti porto in Fatture e applico il filtro scadenze piu utile per vedere subito cosa richiede attenzione.",
            "confidence": 0.86,
            "suggested_actions": actions,
        }

    if any(k in q for k in ["ignorate", "ignora", "ignorata"]):
        return {
            "answer": "Apro Fatture e mostro le ignorate cosi puoi ripristinare o verificare i documenti esclusi.",
            "confidence": 0.84,
            "suggested_actions": ["open_invoices", "toggle_show_ignored"],
        }

    if any(k in q for k in ["fornitore", "fornitori", "p.iva", "partita iva", "anagrafica"]):
        return {
            "answer": "Per Fornitori posso compilare i campi dal testo e controllare dati mancanti prima del salvataggio.",
            "confidence": 0.88,
            "suggested_actions": ["open_suppliers", "suggest_supplier", "check_supplier_missing"],
        }

    if any(k in q for k in ["prima nota", "cassa", "moviment", "entrat", "uscit"]):
        actions = ["open_prima_nota", "suggest_prima_nota", "check_cash_anomalies"]
        if "uscit" in q:
            actions.append("filter_prima_nota_uscite")
        if "entrat" in q:
            actions.append("filter_prima_nota_entrate")
        return {
            "answer": "In Prima Nota posso proporti compilazione rapida, controllo anomalie e filtro automatico sui movimenti rilevanti.",
            "confidence": 0.87,
            "suggested_actions": actions,
        }

    if any(k in q for k in ["fattura", "fatture", "imponibile", "iva"]):
        return {
            "answer": "Per Fatture posso suggerire date/importi, evidenziare warning e applicare filtri operativi.",
            "confidence": 0.87,
            "suggested_actions": ["open_invoices", "suggest_invoice", "check_invoice_anomalies"],
        }

    if any(k in q for k in ["reset", "azzera", "pulisci filtri", "togli filtri"]):
        return {
            "answer": "Posso resettare rapidamente i filtri della pagina attiva per tornare alla vista completa.",
            "confidence": 0.82,
            "suggested_actions": ["reset_filters"],
        }

    if any(k in q for k in ["grafici", "dashboard", "andamento", "kpi"]):
        return {
            "answer": "Ti porto in Dashboard per analizzare trend, costi per categoria/fornitore e flussi entrate-uscite.",
            "confidence": 0.82,
            "suggested_actions": ["open_dashboard"],
        }

    if mod == "fatture":
        return {
            "answer": "Se vuoi procedere velocemente: usa un comando naturale e poi Applica al form, oppure avvia controllo anomalie della fattura.",
            "confidence": 0.72,
            "suggested_actions": ["suggest_invoice", "check_invoice_anomalies", "filter_overdue"],
        }
    if mod == "fornitori":
        return {
            "answer": "Posso compilare anagrafica fornitore da testo e segnalare subito i campi obbligatori mancanti.",
            "confidence": 0.72,
            "suggested_actions": ["suggest_supplier", "check_supplier_missing", "open_suppliers"],
        }
    if mod == "prima-nota":
        return {
            "answer": "Posso compilare rapidamente il movimento, controllare incongruenze e filtrare entrate/uscite.",
            "confidence": 0.72,
            "suggested_actions": ["suggest_prima_nota", "check_cash_anomalies", "filter_prima_nota_uscite"],
        }
    if mod == "ordini":
        return {
            "answer": "In Nuovo ordine puoi incollare un elenco prodotti: provo a ricavare righe e quantità, poi controlli e salvi.",
            "confidence": 0.74,
            "suggested_actions": ["suggest_order_lines", "check_order_anomalies", "open_new_order"],
        }

    return {
        "answer": "Posso guidarti su Fornitori, Fatture e Prima Nota con suggerimenti automatici, controlli anomalie e azioni rapide.",
        "confidence": 0.66,
        "suggested_actions": ["open_suppliers", "open_invoices", "open_prima_nota", "open_dashboard"],
    }


def _parse_shift_times(text: str) -> Tuple[str, str]:
    raw = text or ""
    to_t = lambda h, mi=None: f"{int(h):02d}:{(str(mi or '00').zfill(2) if mi is not None and str(mi) else '00')}"

    m1 = re.search(r"(\d{1,2})[:.](\d{2})?\s*[-–]\s*(\d{1,2})[:.](\d{2})?", raw, flags=re.I)
    if m1:
        return to_t(m1.group(1), m1.group(2)), to_t(m1.group(3), m1.group(4))
    m2 = re.search(
        r"dalle?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:alle?|a)\s*(\d{1,2})(?:[:.](\d{2}))?",
        raw,
        flags=re.I,
    )
    if m2:
        return to_t(m2.group(1), m2.group(2)), to_t(m2.group(3), m2.group(4))
    m3 = re.search(r"\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b", raw)
    if m3:
        return to_t(m3.group(1)), to_t(m3.group(2))
    return "", ""


def _dates_from_context(text: str, context: Dict[str, Any]) -> List[str]:
    ws = str(context.get("week_start") or "")
    we = str(context.get("week_end") or "")
    dates: List[str] = []
    if re.match(r"^\d{4}-\d{2}-\d{2}$", ws) and re.match(r"^\d{4}-\d{2}-\d{2}$", we):
        d0 = datetime.strptime(ws, "%Y-%m-%d").date()
        d1 = datetime.strptime(we, "%Y-%m-%d").date()
        cur = d0
        while cur <= d1:
            dates.append(cur.isoformat())
            cur += timedelta(days=1)
    sel = str(context.get("selected_date") or "")
    if not dates and re.match(r"^\d{4}-\d{2}-\d{2}$", sel):
        dates = [sel]
    lo = _normalize_for_match(text)
    if re.search(r"luned[iì].*venerd[iì]|lun.*ven", lo):
        out = []
        for d in dates:
            dow = datetime.strptime(d, "%Y-%m-%d").weekday()
            if 0 <= dow <= 4:
                out.append(d)
        dates = out or dates
    return dates


def _match_member_name(text: str, member_names: List[str]) -> Optional[str]:
    lo = _normalize_for_match(text)
    for name in member_names:
        nlo = _normalize_for_match(name)
        if not nlo:
            continue
        if nlo in lo or lo in nlo:
            return name
        for tok in nlo.split():
            if len(tok) >= 3 and tok in lo:
                return name
    return None


def suggest_staff_shift(
    text: str,
    member_names: Optional[List[str]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fallback locale quando Gemini non risponde (es. quota 429)."""
    names = member_names or []
    ctx = context or {}
    t_start, t_end = _parse_shift_times(text)
    if not t_start or not t_end:
        return {
            "suggested_shifts": [],
            "suggested_fields": {},
            "warnings": ["Indica gli orari nel comando (es. 8-16)."],
            "confidence": 0.0,
            "local_fallback": True,
        }

    dates = _dates_from_context(text, ctx)
    if not dates:
        sel = str(ctx.get("selected_date") or "")
        dates = [sel] if re.match(r"^\d{4}-\d{2}-\d{2}$", sel) else []

    lo = _normalize_for_match(text)
    shifts: List[Dict[str, str]] = []
    all_kw = re.search(
        r"(tutti|tutte|ogni\s+dipendente|tutti\s+i\s+dipendenti|tutto\s+il\s+personale)",
        lo,
    )
    if all_kw and dates:
        for name in names:
            for wd in dates:
                shifts.append(
                    {
                        "staff_member_name": name,
                        "work_date": wd,
                        "entry_kind": "shift",
                        "time_start": t_start,
                        "time_end": t_end,
                        "notes": "",
                    }
                )
    else:
        hit = _match_member_name(text, names)
        if hit and dates:
            for wd in dates:
                shifts.append(
                    {
                        "staff_member_name": hit,
                        "work_date": wd,
                        "entry_kind": "shift",
                        "time_start": t_start,
                        "time_end": t_end,
                        "notes": "",
                    }
                )
        elif hit:
            wd = str(ctx.get("selected_date") or datetime.now().date().isoformat())
            shifts.append(
                {
                    "staff_member_name": hit,
                    "work_date": wd,
                    "entry_kind": "shift",
                    "time_start": t_start,
                    "time_end": t_end,
                    "notes": "",
                }
            )

    if not shifts:
        return {
            "suggested_shifts": [],
            "suggested_fields": {},
            "warnings": ["Comando non compreso in modalità locale. Usa nome dipendente e orari 8-16."],
            "confidence": 0.0,
            "local_fallback": True,
        }

    return {
        "suggested_shifts": shifts,
        "suggested_fields": {},
        "warnings": ["Compilazione locale (Gemini non disponibile o quota esaurita)."],
        "confidence": 0.55,
        "local_fallback": True,
    }

