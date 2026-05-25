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
    """Ragione sociale / nome anagrafica (fornitore o altro) senza P.IVA, email, telefono."""
    return _extract_supplier_name(t)


def _parse_fornitore_voice_phrase(t: str) -> Dict[str, str]:
    """Es. «fornitore Bar Peroni nome Georgio Rossi» → ragione sociale + referente."""
    out: Dict[str, str] = {}
    s = (t or "").strip()
    if not s:
        return out
    m = re.search(
        r"(?:fornitore|ditta)\s+(.+?)"
        r"(?=\s+(?:nome|referente|contatto|responsabile|persona|partita|p\.?\s*iva|piva|"
        r"codice\s*fiscale|email|e-?mail|pec|telefono|tel\.?|cell|iban|categoria|indirizzo|via)\b|$)",
        s,
        re.I | re.DOTALL,
    )
    if m:
        name = m.group(1).strip().rstrip(" ,;.-")
        if 2 <= len(name) <= 80:
            out["name"] = name
    m_ref = re.search(
        r"\b(?:nome|referente|contatto|responsabile|persona)\s+(?:del\s+referente\s+)?(?:è\s+)?"
        r"([A-Za-zÀ-ÿ' .]{2,60})",
        s,
        re.I,
    )
    if m_ref:
        ref = re.split(r"[,;\n]", m_ref.group(1))[0].strip()
        if 2 <= len(ref) <= 60:
            out["contact_person"] = ref
    return out


def _extract_supplier_name(t: str) -> str:
    if not t:
        return ""
    s = t.strip()
    voice = _parse_fornitore_voice_phrase(s)
    if voice.get("name"):
        return voice["name"]
    m = re.search(
        r"(?:ragione\s+sociale|denominazione|nome\s+fornitore|ditta)\s*[:\s]+([^,;\n]{2,80})",
        s,
        re.I,
    )
    if m:
        return m.group(1).strip().rstrip(" ,;.-")
    seg = re.split(r"[,;\n]", s)[0].strip()
    seg = re.sub(r"^fornitore\s+", "", seg, flags=re.I).strip()
    parts = re.split(
        r"\s+(?=(?:partita|p\.?\s*iva|piva|cod\.?\s*fisc|codice\s*fiscale|c\.?f\.?|"
        r"email|e-?mail|pec|telefono|tel\.?|cell\.?|cellulare|iban|swift|"
        r"categoria|bonifico|pagament|condizioni|indirizzo|via |piazza |viale |corso |"
        r"referente|contatto|responsabile)\b)",
        seg,
        maxsplit=1,
        flags=re.I,
    )[0].strip()
    parts = re.sub(r"\s+\d{11}\b.*$", "", parts).strip()
    parts = re.sub(r"\s+[a-z0-9._%+-]+@[^\s,;]+.*$", "", parts, flags=re.I).strip()
    parts = re.sub(r"\s+(?:\+?39\s?)?0[0-9](?:[\s./-]*\d){6,}.*$", "", parts).strip()
    if 2 <= len(parts) <= 80:
        return parts
    cut = _find_first_keyword_index(s)
    candidate = s if cut < 0 else s[:cut]
    candidate = candidate.split(",")[0].split("\n")[0].strip(" ,;.-")
    candidate = re.sub(
        r"^(?:ragione\s+sociale|denominazione|nome(?:\s+fornitore)?|fornitore|ditta)\s*[:\s]*",
        "",
        candidate,
        flags=re.I,
    ).strip(" ,;.-")
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


def _digits_only(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _extract_vat_number(t: str) -> str:
    """P.IVA: etichetta esplicita o 11 cifre (non telefono che inizia con 0)."""
    if not t:
        return ""
    vat_labels = (
        r"(?:partit[a]?\s*iva|partiva\s*iva|p\.?\s*i\.?\s*v\.?a?\.?|piva|pi\s+va)"
        r"(?:\s*(?:numero|n\.?|°))?"
    )
    m = re.search(vat_labels + r"\s*[:\s]*(?:it\s*)?", t, re.I)
    if m:
        rest = t[m.end() : m.end() + 48]
        chunk = re.split(
            r"\s+(?=codice\s+fiscale|cod\.?\s*fisc|email|e-?mail|telefono|tel\.?|cell|iban|categoria|nome|referente|partita|piva)\b",
            rest,
            maxsplit=1,
            flags=re.I,
        )[0]
        d = _digits_only(chunk)
        if len(d) >= 11:
            return d[-11:]
    m = re.search(
        vat_labels + r"\s*[:\s]*(?:it\s*)?([\d][\d\s./-]{9,28})",
        t,
        re.I,
    )
    if m:
        d = _digits_only(m.group(1))
        if len(d) >= 11:
            return d[-11:]
    for m in re.finditer(r"\b(\d[\d\s./-]{9,18}\d)\b", t):
        d = _digits_only(m.group(1))
        if len(d) == 11 and not d.startswith("0"):
            return d
    m = re.search(r"\b(\d{11})\b", t)
    if m and not m.group(1).startswith("0"):
        return m.group(1)
    return ""


def _extract_fiscal_code(t: str) -> str:
    """Codice fiscale: etichetta o formato standard 16 caratteri."""
    if not t:
        return ""
    m = re.search(r"(?:codice\s*fiscale|cod\.?\s*fisc\.?|c\.?\s*f\.?)\s*[:\s]*(?:è\s+)?", t, re.I)
    if m:
        rest = t[m.end() : m.end() + 64]
        chunk = re.split(
            r"\s+(?=partit[a]?\s*iva|p\.?\s*iva|piva|email|e-?mail|telefono|tel\.?|cell|iban|categoria|nome|referente)\b",
            rest,
            maxsplit=1,
            flags=re.I,
        )[0]
        cf = re.sub(r"[^A-Za-z0-9]", "", chunk).upper()
        if len(cf) >= 16:
            return cf[:16]
        if len(cf) >= 11:
            return cf[:16]
    m = re.search(
        r"(?:codice\s*fiscale|cod\.?\s*fisc\.?|c\.?\s*f\.?)\s*[:\s]*([A-Za-z0-9][A-Za-z0-9\s]{10,22})",
        t,
        re.I,
    )
    if m:
        cf = re.sub(r"\s+", "", m.group(1)).upper()
        if len(cf) >= 11:
            return cf[:16]
    m2 = re.search(
        r"\b([A-Za-z]{6}\d{2}[A-Za-z]\d{2}[A-Za-z]\d{3}[A-Za-z])\b",
        t,
        re.I,
    )
    if m2:
        return m2.group(1).upper()
    return ""


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

    voice_bits = _parse_fornitore_voice_phrase(t)
    name = _extract_supplier_name(t)
    if name:
        out["name"] = name
    if voice_bits.get("contact_person") and not out.get("contact_person"):
        out["contact_person"] = voice_bits["contact_person"]

    vat = _extract_vat_number(t)
    if vat:
        out["vat_number"] = vat

    cf = _extract_fiscal_code(t)
    if cf:
        out["fiscal_code"] = cf

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

    m_cat = re.search(
        r"categoria\s*(?:merceologica)?\s*[:\s]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{1,40})",
        t,
        re.I,
    )
    if m_cat:
        out["merchandise_category"] = re.split(r"[,;\n]", m_cat.group(1))[0].strip().title()
    else:
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
    fields = _sanitize_supplier_suggested_fields(out, t)
    merged = {**current, **fields}
    missing = [k for k in ["name", "vat_number", "iban", "email", "payment_terms"] if not str(merged.get(k) or "").strip()]
    return {
        "suggested_fields": fields,
        "missing_fields": missing,
        "warnings": warnings,
        "confidence": confidence,
    }


def _sanitize_supplier_suggested_fields(
    sf: Dict[str, Any], source_text: str = ""
) -> Dict[str, Any]:
    """Corregge name se contiene email, P.IVA o testo intero dettato."""
    if not isinstance(sf, dict):
        return {}
    out = dict(sf)
    name = str(out.get("name") or "").strip()
    bad = (
        not name
        or "@" in name
        or re.search(r"\b\d{11}\b", name)
        or len(name) > 50
        or re.search(
            r"\b(?:partita|p\.?\s*iva|piva|email|telefono|tel\.?|cell\.?|iban|bonifico|pagament|categoria)\b",
            name,
            re.I,
        )
    )
    if bad:
        fixed = _extract_supplier_name(source_text or name)
        if fixed:
            out["name"] = fixed
    return out


def coalesce_supplier_ai_response(data: Dict[str, Any]) -> Dict[str, Any]:
    """Normalizza chiavi alternative LLM per anagrafica fornitore."""
    if not data:
        return data
    out = dict(data)
    sf = dict(out.get("suggested_fields") or {})
    alias_map = {
        "name": ("ragione_sociale", "ragione sociale", "company_name", "fornitore", "denominazione"),
        "vat_number": ("partita_iva", "piva", "vat", "partita iva"),
        "fiscal_code": ("codice_fiscale", "cf", "codice fiscale"),
        "email": ("e_mail", "mail", "pec"),
        "phone": ("telefono", "tel", "cellulare", "cell"),
        "city": ("citta", "città"),
        "contact_person": ("referente", "contatto", "responsabile"),
        "payment_terms": ("condizioni_pagamento", "pagamento", "condizioni pagamento"),
        "merchandise_category": ("categoria", "categoria_merceologica", "settore"),
        "notes": ("note", "nota"),
    }
    for target, aliases in alias_map.items():
        if str(sf.get(target) or "").strip():
            continue
        for alt in aliases:
            v = sf.get(alt)
            if v is not None and str(v).strip():
                sf[target] = v
                break
    out["suggested_fields"] = sf
    return out


def merge_supplier_fields_response(
    llm: Optional[Dict[str, Any]], heur: Dict[str, Any], source_text: str = ""
) -> Dict[str, Any]:
    """Unisce LLM (capisce le sezioni) + euristiche (correzione e buchi)."""
    heur = coalesce_supplier_ai_response(heur or {})
    llm = coalesce_supplier_ai_response(llm or {})
    sf_h = _sanitize_supplier_suggested_fields(
        heur.get("suggested_fields") or {}, source_text
    )
    sf_l = _sanitize_supplier_suggested_fields(llm.get("suggested_fields") or {}, source_text)
    sf: Dict[str, Any] = dict(sf_l)
    for k, v in sf_h.items():
        if v is not None and str(v).strip() != "" and not str(sf.get(k) or "").strip():
            sf[k] = v
    sf = _sanitize_supplier_suggested_fields(sf, source_text)
    missing = [k for k in ["name", "vat_number", "iban", "email", "payment_terms"] if not str(sf.get(k) or "").strip()]
    warnings = list(dict.fromkeys((heur.get("warnings") or []) + (llm.get("warnings") or [])))
    conf = max(float(heur.get("confidence") or 0), float(llm.get("confidence") or 0))
    return {
        "suggested_fields": sf,
        "missing_fields": missing or heur.get("missing_fields") or [],
        "warnings": warnings,
        "confidence": round(min(0.99, conf), 2),
    }


def supplier_heuristics_usable(data: Dict[str, Any]) -> bool:
    """Percorso veloce: ragione sociale + almeno un altro campo utile."""
    sf = (data or {}).get("suggested_fields") or {}
    name = str(sf.get("name") or "").strip()
    if len(name) < 2:
        return False
    keys = ("vat_number", "email", "phone", "fiscal_code", "iban", "contact_person", "city", "payment_terms")
    filled = sum(1 for k in keys if str(sf.get(k) or "").strip())
    return filled >= 1


def supplier_instant_path_ok(data: Dict[str, Any], source_text: str = "") -> bool:
    """True se le euristiche bastano: niente chiamata Ollama (compilazione immediata)."""
    sf = _sanitize_supplier_suggested_fields(
        (data or {}).get("suggested_fields") or {}, source_text
    )
    name = str(sf.get("name") or "").strip()
    if len(name) < 2 or len(name) > 50:
        return False
    if "@" in name or re.search(r"\b\d{11}\b", name):
        return False
    if re.search(
        r"\b(?:partita|p\.?\s*iva|piva|email|telefono|tel\.?|iban|bonifico|categoria)\b",
        name,
        re.I,
    ):
        return False
    keys = (
        "vat_number",
        "email",
        "phone",
        "fiscal_code",
        "iban",
        "contact_person",
        "city",
        "payment_terms",
        "merchandise_category",
    )
    if sum(1 for k in keys if str(sf.get(k) or "").strip()) >= 1:
        return True
    words = re.split(r"\s+", (source_text or "").strip())
    return len(words) <= 8


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


def _flex_supplier_pattern(name: str) -> str:
    """Pattern regex flessibile (spazi, accenti) per il nome fornitore."""
    words = [w for w in re.split(r"\s+", (name or "").strip()) if w]
    if not words:
        return ""
    parts: List[str] = []
    for word in words:
        chars: List[str] = []
        for c in word:
            base = _strip_accents(c)
            if base.lower() == c.lower():
                chars.append(re.escape(c))
            else:
                chars.append(f"[{re.escape(c)}{re.escape(base)}]")
        parts.append("".join(chars))
    return r"\s+".join(parts)


def _strip_supplier_from_text(text: str, supplier_name: Optional[str]) -> str:
    """Rimuove il fornitore (e varianti) dal testo prima del parsing prodotti."""
    s = (text or "").strip()
    if not s or not supplier_name:
        return s
    frag = _flex_supplier_pattern(supplier_name)
    if not frag:
        return s
    legal = r"(?:\s+(?:s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?))?"
    for pat in (
        rf"(?:fornitore|forn\.?)\s+{frag}{legal}\s*[,:]?\s*",
        rf"ordine\s+(?:a|per|da|presso)\s+{frag}{legal}\s*[,:]?\s*",
        rf"(?:da|presso)\s+{frag}{legal}\s*[,:]?\s*",
        rf"^(?:{frag}){legal}\s*[,:]?\s*",
    ):
        s = re.sub(pat, " ", s, count=1, flags=re.I)
    sup_words = [w for w in re.split(r"\s+", supplier_name.strip()) if w]
    text_words = s.split()
    n_strip = 0
    for i, sw in enumerate(sup_words):
        if i >= len(text_words):
            break
        if _normalize_for_match(sw) == _normalize_for_match(text_words[i]):
            n_strip = i + 1
        else:
            break
    if n_strip > 0:
        rest = " ".join(text_words[n_strip:]).strip()
        if rest:
            s = rest
    return re.sub(r"\s+", " ", s).strip()


def _strip_supplier_from_description(desc: str, supplier_name: Optional[str]) -> str:
    """Toglie il nome fornitore dalla descrizione prodotto."""
    d = (desc or "").strip()
    if not d or not supplier_name:
        return d
    if _normalize_for_match(d) == _normalize_for_match(supplier_name):
        return ""
    frag = _flex_supplier_pattern(supplier_name)
    if frag:
        legal = r"(?:\s+(?:s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?))?"
        d = re.sub(rf"^(?:{frag}){legal}\s+", "", d, count=1, flags=re.I).strip()
        d = re.sub(rf"\s+(?:{frag}){legal}$", "", d, count=1, flags=re.I).strip()
    sup_words = [w for w in re.split(r"\s+", supplier_name.strip()) if w]
    d_words = d.split()
    n_strip = 0
    for i, sw in enumerate(sup_words):
        if i >= len(d_words):
            break
        if _normalize_for_match(sw) == _normalize_for_match(d_words[i]):
            n_strip = i + 1
        else:
            break
    if n_strip > 0:
        rest = " ".join(d_words[n_strip:]).strip(" ,;:-")
        if len(rest) >= 2:
            d = rest
    return d.strip()


def _sanitize_order_lines_for_supplier(
    lines: List[Dict[str, Any]], supplier_name: Optional[str]
) -> List[Dict[str, Any]]:
    if not supplier_name or not lines:
        return lines
    out: List[Dict[str, Any]] = []
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        row = dict(ln)
        row["product_description"] = _strip_supplier_from_description(
            str(row.get("product_description") or ""), supplier_name
        )
        row = normalize_order_line(row)
        if not (
            row.get("product_description")
            or row.get("pieces")
            or row.get("weight_kg")
        ):
            continue
        if _normalize_for_match(str(row.get("product_description") or "")) == _normalize_for_match(
            supplier_name
        ):
            continue
        out.append(row)
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

    matched_supplier = out.get("supplier_name")
    if not matched_supplier and supplier_names:
        m_sup = _match_supplier_name(t, supplier_names)
        if m_sup:
            matched_supplier = m_sup[0]

    products_text = _extract_products_text_from_order(t, matched_supplier, supplier_names)

    lines_result = suggest_order_lines(products_text)
    suggested_lines = lines_result.get("suggested_lines") or []
    if matched_supplier:
        suggested_lines = _sanitize_order_lines_for_supplier(suggested_lines, matched_supplier)

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


def _parse_pieces_value(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        n = int(float(str(value).replace(",", ".")))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _parse_weight_value(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        w = float(str(value).replace(",", "."))
        return w if w > 0 else None
    except (TypeError, ValueError):
        return None


_ITALIAN_NUMBER_WORDS: Dict[str, int] = {
    "zero": 0,
    "uno": 1,
    "una": 1,
    "un": 1,
    "due": 2,
    "tre": 3,
    "quattro": 4,
    "cinque": 5,
    "sei": 6,
    "sette": 7,
    "otto": 8,
    "nove": 9,
    "dieci": 10,
    "undici": 11,
    "dodici": 12,
    "tredici": 13,
    "quattordici": 14,
    "quindici": 15,
    "sedici": 16,
    "diciassette": 17,
    "diciotto": 18,
    "diciannove": 19,
    "venti": 20,
    "trenta": 30,
    "quaranta": 40,
    "cinquanta": 50,
}


def _parse_quantity_token(token: str) -> Optional[int]:
    t = (token or "").strip().lower()
    if not t:
        return None
    if t in _ITALIAN_NUMBER_WORDS:
        n = _ITALIAN_NUMBER_WORDS[t]
        return n if n > 0 else None
    try:
        n = int(float(t.replace(",", ".")))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _clean_product_name(name: str) -> str:
    s = re.sub(r"\b(?:pezzi?|pz\.?|kg|chilogrammi?|di|del|della|un|una)\b", " ", name or "", flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" ,;:-")
    return s


def _extract_pieces_from_phrase(text: str) -> Tuple[Optional[int], str]:
    """Estrae i pezzi (anche 'dieci pezzi', 'pezzi 10') e restituisce il testo residuo."""
    remainder = re.sub(r"\s+", " ", (text or "").strip())
    if not remainder:
        return None, remainder

    piece_patterns = [
        r"(\d+)\s*pezzi?\b",
        r"\bpezzi?\s*(\d+)\b",
        r"(\d+)\s*pz\.?\b",
        r"\bpz\.?\s*(\d+)\b",
        r"\bpezzi?\s+([a-zàèéìòù]+)\b",
        r"\b([a-zàèéìòù]+)\s+pezzi?\b",
    ]
    for pat in piece_patterns:
        m = re.search(pat, remainder, re.I)
        if not m:
            continue
        n = _parse_quantity_token(m.group(1))
        if n is not None:
            remainder = (remainder[: m.start()] + remainder[m.end() :]).strip()
            return n, remainder
    return None, remainder


def _extract_weight_from_phrase(text: str) -> Tuple[Optional[float], str]:
    remainder = re.sub(r"\s+", " ", (text or "").strip())
    if not remainder:
        return None, remainder
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*kg\b", remainder, re.I)
    if m:
        w = float(m.group(1).replace(",", "."))
        remainder = (remainder[: m.start()] + remainder[m.end() :]).strip()
        return w, remainder
    m = re.search(r"\bkg\s*(\d+(?:[.,]\d+)?)\b", remainder, re.I)
    if m:
        w = float(m.group(1).replace(",", "."))
        remainder = (remainder[: m.start()] + remainder[m.end() :]).strip()
        return w, remainder
    return None, remainder


def _extract_fields_from_mixed_phrase(text: str) -> Dict[str, Any]:
    """Da frasi vocali: prima pezzi, poi kg, poi nome prodotto."""
    work = re.sub(r"\s+", " ", (text or "").strip())
    if not work:
        return {"product_description": "", "pieces": None, "weight_kg": None, "note": None}

    pieces, remainder = _extract_pieces_from_phrase(work)
    weight_kg, remainder = _extract_weight_from_phrase(remainder)

    remainder = re.sub(r"\b(?:pezzi?|pz\.?|kg)\b", " ", remainder, flags=re.I)
    remainder = re.sub(r"\s+", " ", remainder).strip()

    m = re.match(r"^(\d+)\s*[x×]\s*(.+)$", remainder, re.I)
    if m:
        pieces = pieces or int(m.group(1))
        remainder = m.group(2).strip()
    else:
        m = re.match(r"^(\d+)\s+(.+)$", remainder)
        if m and not re.match(r"kg\b", m.group(2), re.I):
            pieces = pieces or int(m.group(1))
            remainder = m.group(2).strip()
        elif pieces is None:
            m = re.match(r"^(.+?)\s+(\d+)\s*$", remainder)
            if m and len(m.group(1).strip()) >= 2:
                remainder = m.group(1).strip()
                pieces = int(m.group(2))

    desc = _clean_product_name(remainder)
    return {
        "product_description": desc,
        "pieces": pieces,
        "weight_kg": weight_kg,
        "note": None,
    }


def parse_order_line_from_text(line: str) -> Dict[str, Any]:
    """Una frase prodotto → dict con product_description, pieces, weight_kg separati."""
    s = _clean_product_chunk(line)
    if not s:
        return normalize_order_line(
            {"product_description": "", "pieces": None, "weight_kg": None, "note": None}
        )

    # Prima pezzi/pz (priorità su kg), poi kg, poi numeri generici
    patterns: List[Tuple[Any, ...]] = [
        (r"^(.+?)\s+(\d+)\s*pezzi?\b", "p_last"),
        (r"^(.+?)\s+pezzi?\s+(\d+)\b", "p_mid"),
        (r"^(.+?)\s+pezzi?\s+([a-zàèéìòù]+)\b", "p_mid_word"),
        (r"^(.+?)\s+([a-zàèéìòù]+)\s+pezzi?\b", "p_last_word"),
        (r"^(\d+)\s*pezzi?\s+(.+)$", "p_first"),
        (r"^pezzi?\s+(\d+)\s+(.+)$", "p_prefix"),
        (r"^pezzi?\s+([a-zàèéìòù]+)\s+(.+)$", "p_prefix_word"),
        (r"^([a-zàèéìòù]+)\s+pezzi?\s+(.+)$", "p_first_word"),
        (r"^(\d+)\s*pz\.?\s+(.+)$", "pz_first"),
        (r"^(.+?)\s+(\d+)\s*pz\.?$", "pz_last"),
        (r"^(\d+(?:[.,]\d+)?)\s*kg\s+(?:di\s+)?(.+)$", "w_first"),
        (r"^(.+?)\s+(\d+(?:[.,]\d+)?)\s*kg$", "w_last"),
        (r"^(.+?)\s+kg\s+(\d+(?:[.,]\d+)?)$", "w_kg_mid"),
        (r"^kg\s+(\d+(?:[.,]\d+)?)\s+(.+)$", "w_kg_prefix"),
        (r"^(\d+)\s*[x×]\s*(.+)$", "x"),
        (r"^(\d+)\s+(.{2,})$", "n_first"),
        (r"^(.+?)\s+(\d+)\s*(?:pz|pezzi)?$", "n_last"),
    ]
    for pat, kind in patterns:
        m = re.match(pat, s, re.I)
        if not m:
            continue
        if kind == "w_first":
            row = {"product_description": m.group(2).strip(), "pieces": None, "weight_kg": float(m.group(1).replace(",", ".")), "note": None}
        elif kind == "w_last":
            row = {"product_description": m.group(1).strip(), "pieces": None, "weight_kg": float(m.group(2).replace(",", ".")), "note": None}
        elif kind == "w_kg_mid":
            row = {"product_description": m.group(1).strip(), "pieces": None, "weight_kg": float(m.group(2).replace(",", ".")), "note": None}
        elif kind == "w_kg_prefix":
            row = {"product_description": m.group(2).strip(), "pieces": None, "weight_kg": float(m.group(1).replace(",", ".")), "note": None}
        elif kind in ("p_last", "p_mid", "pz_last"):
            row = {"product_description": m.group(1).strip(), "pieces": int(m.group(2)), "weight_kg": None, "note": None}
        elif kind in ("p_mid_word", "p_last_word", "p_prefix_word", "p_first_word"):
            if kind in ("p_mid_word", "p_last_word"):
                n = _parse_quantity_token(m.group(2))
                desc_g = m.group(1).strip()
            else:
                n = _parse_quantity_token(m.group(1))
                desc_g = m.group(2).strip()
            if n is None:
                continue
            row = {"product_description": desc_g, "pieces": n, "weight_kg": None, "note": None}
        elif kind in ("p_first", "p_prefix", "pz_first"):
            row = {"product_description": m.group(2).strip(), "pieces": int(m.group(1)), "weight_kg": None, "note": None}
        elif kind == "x":
            row = {"product_description": m.group(2).strip(), "pieces": int(m.group(1)), "weight_kg": None, "note": None}
        elif kind == "n_first":
            rest = m.group(2).strip()
            if re.match(r"kg\b", rest, re.I):
                continue
            row = {"product_description": rest, "pieces": int(m.group(1)), "weight_kg": None, "note": None}
        else:
            row = {"product_description": m.group(1).strip(), "pieces": int(m.group(2)), "weight_kg": None, "note": None}
        return normalize_order_line(row)

    return normalize_order_line(_extract_fields_from_mixed_phrase(s))


def normalize_order_line(line: Dict[str, Any]) -> Dict[str, Any]:
    """Separa quantità (pezzi), peso (kg) e nome prodotto se uniti nello stesso campo."""
    desc = str(line.get("product_description") or "").strip()
    pieces = _parse_pieces_value(line.get("pieces"))
    weight_kg = _parse_weight_value(line.get("weight_kg"))
    note = line.get("note")

    if not desc and pieces is None and weight_kg is None:
        return {
            "product_description": desc,
            "pieces": None,
            "weight_kg": None,
            "note": note,
        }

    m = re.match(r"^(\d+(?:[.,]\d+)?)\s*kg\s+(.+)$", desc, re.I)
    if m:
        weight_kg = weight_kg or float(m.group(1).replace(",", "."))
        desc = m.group(2).strip()
        pieces = None
    else:
        m = re.match(r"^(.+?)\s+(\d+(?:[.,]\d+)?)\s*kg$", desc, re.I)
        if m and len(m.group(1).strip()) >= 2:
            weight_kg = weight_kg or float(m.group(2).replace(",", "."))
            desc = m.group(1).strip()
            pieces = None

    if pieces is not None:
        for pat in (
            rf"^{pieces}\s*[x×]\s*(.+)$",
            rf"^{pieces}\s+(.+)$",
            rf"^(.+?)\s+{pieces}\s*(?:pz|pezzi|pz\.)?$",
        ):
            m = re.match(pat, desc, re.I)
            if m:
                cleaned = m.group(1).strip()
                if len(cleaned) >= 2:
                    desc = cleaned
                break
    else:
        m = re.match(r"^(\d+)\s*[x×]\s*(.+)$", desc, re.I)
        if m:
            pieces = int(m.group(1))
            desc = m.group(2).strip()
        else:
            m = re.match(r"^(\d+)\s+(.+)$", desc)
            if m:
                rest = m.group(2).strip()
                if len(rest) >= 2 and not re.match(r"kg\b", rest, re.I):
                    pieces = int(m.group(1))
                    desc = rest
            if pieces is None:
                m = re.match(r"^(.+?)\s+(\d+)\s*(?:pz|pezzi|pz\.)?$", desc, re.I)
                if m and len(m.group(1).strip()) >= 2:
                    desc = m.group(1).strip()
                    pieces = int(m.group(2))

    if re.search(r"\bpezzi?\b|\bpz\.?\b", desc, re.I) and pieces is None:
        pieces, desc = _extract_pieces_from_phrase(desc)
        desc = _clean_product_name(desc)

    desc = _clean_product_name(desc)
    return {
        "product_description": desc,
        "pieces": pieces,
        "weight_kg": weight_kg,
        "note": note,
    }


def order_line_well_formed(line: Dict[str, Any]) -> bool:
    """Riga valida: nome pulito, quantità nel campo giusto."""
    if not isinstance(line, dict):
        return False
    desc = str(line.get("product_description") or "").strip()
    if len(desc) < 2:
        return False
    if re.match(r"^\d+\s*[x×]?\s*", desc, re.I):
        return False
    if re.match(r"^\d+(?:[.,]\d+)?\s*kg\b", desc, re.I):
        return False
    if re.search(r"\bkg\b", desc, re.I) and line.get("weight_kg") is None:
        return False
    junk = (
        "domani",
        "dopodomani",
        "oggi",
        "luned",
        "marted",
        "mercoled",
        "gioved",
        "venerd",
        "sabato",
        "domenica",
        "ordine",
        "fornitore",
        "consegna",
    )
    dl = desc.lower()
    if any(dl == j or dl.startswith(j + " ") for j in junk):
        return False
    if len(desc) > 45:
        return False
    if len(_split_order_product_chunks(desc)) >= 2:
        return False
    if desc.count(",") >= 1 and re.search(r"\d", desc):
        return False
    return True


def _order_line_needs_split(line: Dict[str, Any]) -> bool:
    if not isinstance(line, dict):
        return False
    desc = str(line.get("product_description") or "").strip()
    if not desc:
        return False
    if len(desc) > 42:
        return True
    if len(_split_order_product_chunks(desc)) >= 2:
        return True
    if re.search(r"\b\d+\b.*\b\d+\b", desc) and re.search(r"(?:kg|pezzi?|pz\.?)", desc, re.I):
        return True
    if desc.count(",") >= 1 and re.search(r"\d", desc):
        return True
    return False


def expand_order_lines(lines: Any) -> List[Dict[str, Any]]:
    """Spezza righe con più prodotti in una sola descrizione."""
    if not isinstance(lines, list):
        return []
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        if _order_line_needs_split(ln):
            desc = str(ln.get("product_description") or "").strip()
            for chunk in _split_order_product_chunks(desc):
                row = parse_order_line_from_text(chunk)
                if not (row.get("product_description") or row.get("pieces") or row.get("weight_kg")):
                    continue
                key = (
                    str(row.get("product_description") or "").lower(),
                    row.get("pieces"),
                    row.get("weight_kg"),
                )
                if key in seen:
                    continue
                seen.add(key)
                out.append(row)
        else:
            row = normalize_order_line(ln)
            if not (row.get("product_description") or row.get("pieces") or row.get("weight_kg")):
                continue
            key = (
                str(row.get("product_description") or "").lower(),
                row.get("pieces"),
                row.get("weight_kg"),
            )
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
    return out


def order_lines_well_formed(lines: Any) -> bool:
    if not isinstance(lines, list) or not lines:
        return False
    return all(order_line_well_formed(ln) for ln in lines if isinstance(ln, dict))


def _line_from_loose_obj(obj: Any) -> Optional[Dict[str, Any]]:
    if isinstance(obj, str):
        s = obj.strip()
        if not s:
            return None
        return {"product_description": s, "pieces": None, "weight_kg": None, "note": None}
    if not isinstance(obj, dict):
        return None
    desc = (
        obj.get("product_description")
        or obj.get("product_name")
        or obj.get("nome_prodotto")
        or obj.get("nome")
        or obj.get("description")
        or obj.get("descrizione")
        or obj.get("prodotto")
    )
    pieces = obj.get("pieces")
    if pieces is None:
        pieces = obj.get("pezzi") or obj.get("quantita") or obj.get("qty") or obj.get("quantity")
    weight = obj.get("weight_kg")
    if weight is None:
        weight = obj.get("peso") or obj.get("kg") or obj.get("weight")
    note = obj.get("note") or obj.get("notes") or obj.get("nota")
    if not desc and pieces is None and weight is None:
        return None
    return {
        "product_description": str(desc or "").strip(),
        "pieces": pieces,
        "weight_kg": weight,
        "note": note,
    }


def coalesce_order_ai_response(data: Dict[str, Any]) -> Dict[str, Any]:
    """Unifica chiavi alternative dell'LLM (items, nome_prodotto, righe annidate, ecc.)."""
    if not data:
        return data
    out = dict(data)
    sf = out.get("suggested_fields")
    if not isinstance(sf, dict):
        sf = {}
    else:
        sf = dict(sf)

    candidates: List[Any] = []
    for key in ("suggested_lines", "lines", "items", "products", "righe", "order_lines"):
        arr = out.get(key)
        if isinstance(arr, list):
            candidates.extend(arr)
    for key in ("lines", "items", "products", "righe", "order_lines"):
        arr = sf.get(key)
        if isinstance(arr, list):
            candidates.extend(arr)
        if key in sf and isinstance(sf[key], list):
            sf.pop(key, None)

    parsed: List[Dict[str, Any]] = []
    seen: set = set()

    def _append_parsed(row: Dict[str, Any]) -> None:
        if not (row.get("product_description") or row.get("pieces") or row.get("weight_kg")):
            return
        key = (
            str(row.get("product_description") or "").lower(),
            row.get("pieces"),
            row.get("weight_kg"),
        )
        if key in seen:
            return
        seen.add(key)
        parsed.append(row)

    for item in candidates:
        ln = _line_from_loose_obj(item)
        if not ln:
            continue
        if _order_line_needs_split(ln):
            desc = str(ln.get("product_description") or "").strip()
            for chunk in _split_order_product_chunks(desc):
                _append_parsed(parse_order_line_from_text(chunk))
            continue
        _append_parsed(normalize_order_line(ln))

    parsed = expand_order_lines(parsed)

    for key in ("lines", "items", "products", "righe", "order_lines"):
        out.pop(key, None)

    out["suggested_fields"] = sf
    out["suggested_lines"] = parsed
    return out


def order_lines_usable(lines: Any) -> bool:
    """True se c'è almeno una riga con dato utile."""
    if not isinstance(lines, list):
        return False
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        if str(ln.get("product_description") or "").strip():
            return True
        if ln.get("pieces") or ln.get("weight_kg"):
            return True
    return False


def order_full_heuristics_usable(data: Dict[str, Any]) -> bool:
    """Percorso veloce solo se ogni riga è nel formato corretto."""
    lines = (data or {}).get("suggested_lines")
    return order_lines_well_formed(lines)


def merge_order_full_response(
    llm: Optional[Dict[str, Any]], heur: Dict[str, Any]
) -> Dict[str, Any]:
    """Preferisce LLM dove valorizzato; riempie buchi con euristiche (righe, fornitore, date)."""
    heur = heur or {}
    llm = coalesce_order_ai_response(llm or {})
    heur = coalesce_order_ai_response(heur)

    sf_heur = heur.get("suggested_fields") or {}
    sf_llm = llm.get("suggested_fields") or {}
    sf: Dict[str, Any] = dict(sf_heur)
    for k, v in sf_llm.items():
        if v is not None and str(v).strip() != "":
            sf[k] = v

    lines_heur = expand_order_lines(heur.get("suggested_lines") or [])
    lines_llm = expand_order_lines(llm.get("suggested_lines") or [])

    def _lines_score(lines: List[Dict[str, Any]]) -> int:
        if not lines:
            return -1
        if not order_lines_well_formed(lines):
            return len(lines)
        return 100 + len(lines)

    if order_lines_well_formed(lines_llm) and lines_llm:
        lines = lines_llm
    elif order_lines_well_formed(lines_heur) and lines_heur:
        lines = lines_heur
    elif _lines_score(lines_llm) >= _lines_score(lines_heur):
        lines = lines_llm if lines_llm else lines_heur
    else:
        lines = lines_heur if lines_heur else lines_llm

    supplier_name = sf.get("supplier_name")
    if supplier_name and lines:
        lines = _sanitize_order_lines_for_supplier(lines, str(supplier_name))

    warnings = list(dict.fromkeys((heur.get("warnings") or []) + (llm.get("warnings") or [])))
    if not lines:
        warnings.append("Nessuna riga prodotto estratta: controlla il testo o aggiungi righe a mano")

    conf_llm = float(llm.get("confidence") or 0)
    conf_heur = float(heur.get("confidence") or 0)
    confidence = max(conf_llm, conf_heur)
    if lines:
        confidence = max(confidence, 0.72)

    return {
        "suggested_fields": sf,
        "suggested_lines": lines,
        "warnings": warnings,
        "confidence": round(min(0.99, confidence), 2),
    }


def normalize_order_suggest_result(data: Dict[str, Any]) -> Dict[str, Any]:
    """Normalizza suggested_lines in risposta suggest_order_lines / suggest_order_full."""
    if not data:
        return data
    data = coalesce_order_ai_response(data)
    lines = data.get("suggested_lines")
    if isinstance(lines, list):
        expanded = expand_order_lines([ln for ln in lines if isinstance(ln, dict)])
        data = {**data, "suggested_lines": expanded}
    return data


_DATE_WORDS_RE = re.compile(
    r"^(?:domani|dopodomani|oggi|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\s*[,:]?\s*",
    re.I,
)


def _extract_products_text_from_order(
    t: str,
    matched_supplier: Optional[str] = None,
    supplier_names: Optional[List[str]] = None,
) -> str:
    """Toglie fornitore, date e intestazioni; lascia solo l'elenco merce."""
    products_text = (t or "").strip()
    m_prods = re.search(r"prodott[oi]?\s*[:\s]*(.+)$", products_text, re.I | re.S)
    if m_prods:
        products_text = m_prods.group(1)
    if matched_supplier:
        frag = _flex_supplier_pattern(matched_supplier)
        if frag:
            products_text = re.sub(
                rf"^ordine\s+(?:a|per|da|presso)\s+{frag}\s*(?::\s*|,\s*(?=\d)|\s+(?=\d))",
                "",
                products_text,
                count=1,
                flags=re.I,
            )
    products_text = re.sub(
        r"^ordine\s+(?:a|per)\s+[^:,\n]+?(?::\s*|,\s*(?=\d)|\s+(?=\d))",
        "",
        products_text,
        count=1,
        flags=re.I,
    )
    products_text = _strip_known_dates(products_text)
    for pat in [
        r"destinazione\s*[:\s]*[^\n,;]*",
        r"firma\s+(?:ordine|scarico)\s*[:\s]*[^\n,;]*",
        r"ordinato\s+da\s*[:\s]*[^\n,;]*",
        r"^note?\s*[:\s]*[^\n;]*",
        r"iva\s*(?:al)?\s*\d{1,2}\s*%",
        r"consegna(?:\s+prevista)?\s*[:\s]*[^\n,;]*",
    ]:
        products_text = re.sub(pat, " ", products_text, flags=re.I | re.M)
    supplier_to_strip = matched_supplier
    if not supplier_to_strip and supplier_names:
        m = _match_supplier_name(products_text, supplier_names)
        if m:
            supplier_to_strip = m[0]
    if supplier_to_strip:
        products_text = _strip_supplier_from_text(products_text, supplier_to_strip)
    return products_text.strip()


def _clean_product_chunk(seg: str) -> str:
    s = (seg or "").strip().strip(",").strip()
    if not s:
        return ""
    s = re.sub(r"\s+e\s*$", "", s, flags=re.I).strip()
    for _ in range(3):
        s2 = _DATE_WORDS_RE.sub("", s).strip()
        if s2 == s:
            break
        s = s2
    return s


_PRODUCT_ENTRY_START_PATTERNS = (
    r"\b\d+(?:[.,]\d+)?\s*kg\b",
    r"\b[A-Za-zÀ-ÿ]{2,}\s+kg\s+\d+(?:[.,]\d+)?\b",
    r"\b\d+\s*pz\.?\b",
    r"\b\d+\s*[x×]\b",
    r"\b(?<!\d)(?<!pezzi\s)(?<!pz\.\s)(?<!\w)\d+\s+(?!kg\b)(?=[A-Za-zÀ-ÿ])",
)


def _product_entry_start_indices(line: str) -> List[int]:
    """Indici dove inizia un nuovo prodotto (es. '5 kg', '10 arance', '3 carciofi')."""
    s = (line or "").strip()
    if not s:
        return []
    starts = {0}
    for pat in _PRODUCT_ENTRY_START_PATTERNS:
        for m in re.finditer(pat, s, re.I):
            starts.add(m.start())
    return sorted(starts)


def _split_by_product_entry_starts(line: str) -> List[str]:
    """Spezza una frase lunga senza virgole: ogni inizio prodotto = una riga."""
    s = (line or "").strip()
    starts = _product_entry_start_indices(s)
    if not starts:
        return []
    out: List[str] = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(s)
        seg = _clean_product_chunk(s[start:end])
        if len(seg) >= 2:
            out.append(seg)
    return out


def _insert_commas_between_products(line: str) -> str:
    """Inserisce virgole tra prodotti consecutivi (voce senza pause)."""
    s = (line or "").strip()
    starts = _product_entry_start_indices(s)
    extra = [st for st in starts if st > 0]
    if not extra:
        return s
    parts: List[str] = []
    last = 0
    for st in sorted(extra):
        parts.append(s[last:st].strip().rstrip(","))
        last = st
    parts.append(s[last:].strip())
    return ", ".join(p for p in parts if p)


def _split_line_into_product_segments(line: str) -> List[str]:
    """Un segmento = un prodotto (virgola, 'e', o split automatico multi-prodotto)."""
    line = (line or "").strip()
    if not line:
        return []

    if "," not in line:
        auto = _split_by_product_entry_starts(line)
        if len(auto) >= 2:
            return auto
        if " e " not in line.lower():
            line = _insert_commas_between_products(line)

    chunks: List[str] = [line]
    if "," in line:
        chunks = []
        for seg in re.split(r",\s*(?=\d|[A-Za-zÀ-ÿ])", line):
            s = _clean_product_chunk(seg)
            if len(s) >= 2:
                chunks.append(s)

    out: List[str] = []
    for chunk in chunks:
        if re.search(r"\s+e\s+", chunk, re.I):
            for seg in re.split(r"\s+e\s+", chunk, flags=re.I):
                s = _clean_product_chunk(seg)
                if len(s) >= 2:
                    out.append(s)
        else:
            s = _clean_product_chunk(chunk)
            if len(s) >= 2:
                out.append(s)
    return out


def _split_order_product_chunks(text: str) -> List[str]:
    """Spezza elenco prodotti: ogni voce diventa una riga ordine separata."""
    t = (text or "").strip()
    if not t:
        return []
    out: List[str] = []
    for raw in re.split(r"[\n;]+", t):
        line = raw.strip()
        if not line:
            continue
        out.extend(_split_line_into_product_segments(line))
    return out


def suggest_order_lines(text: str) -> Dict[str, Any]:
    """Estrae righe ordine da testo libero (una riga per prodotto)."""
    warnings: List[str] = []
    lines_out: List[Dict[str, Any]] = []
    for chunk in _split_order_product_chunks(text):
        if not chunk:
            continue
        row = parse_order_line_from_text(chunk)
        if row.get("product_description") or row.get("pieces") or row.get("weight_kg"):
            lines_out.append(row)
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


_WEEKDAY_IT_PATTERNS: List[tuple] = [
    (r"\blunedi\b", 0),
    (r"\bmartedi\b", 1),
    (r"\bmercoledi\b", 2),
    (r"\bgiovedi\b", 3),
    (r"\bvenerdi\b", 4),
    (r"\bsabato\b", 5),
    (r"\bdomenica\b", 6),
]


def _filter_dates_by_weekday_mention(text: str, dates: List[str]) -> List[str]:
    lo = _normalize_for_match(text)
    # Intervallo lun–ven: non restringere al solo primo giorno citato.
    if re.search(r"lunedi.*venerdi|lun.*ven|da\s+lunedi\s+a\s+venerdi", lo):
        return dates
    mentioned = [target for pat, target in _WEEKDAY_IT_PATTERNS if re.search(pat, lo)]
    if len(mentioned) == 1:
        target_dow = mentioned[0]
        out = [
            d
            for d in dates
            if datetime.strptime(d, "%Y-%m-%d").weekday() == target_dow
        ]
        if out:
            return out
    return dates


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
    if re.search(r"lunedi.*venerdi|lun.*ven|da\s+lunedi\s+a\s+venerdi", lo):
        out = []
        for d in dates:
            dow = datetime.strptime(d, "%Y-%m-%d").weekday()
            if 0 <= dow <= 4:
                out.append(d)
        dates = out or dates
    elif re.search(r"\bsabato\b", lo) and not re.search(r"\bdomenica\b", lo):
        dates = [d for d in dates if datetime.strptime(d, "%Y-%m-%d").weekday() == 5] or dates
    dates = _filter_dates_by_weekday_mention(text, dates)
    return dates


def _staff_shifts_from_payload(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    shifts: List[Dict[str, Any]] = []
    for item in data.get("suggested_shifts") or []:
        if isinstance(item, dict):
            shifts.append(item)
    sf = data.get("suggested_fields")
    if isinstance(sf, dict) and (
        sf.get("staff_member_name") or sf.get("work_date") or sf.get("time_start") or sf.get("time_end")
    ):
        shifts.append(sf)
    return shifts


def enrich_staff_shift_response(
    data: Dict[str, Any],
    text: str,
    member_names: List[str],
    context: Dict[str, Any],
) -> Dict[str, Any]:
    """Completa date/nomi mancanti dopo risposta LLM."""
    if not data:
        return data
    dates = _dates_from_context(text, context)
    sel = str(context.get("selected_date") or "")
    if not dates and re.match(r"^\d{4}-\d{2}-\d{2}$", sel):
        dates = [sel]
    enriched: List[Dict[str, Any]] = []
    for raw in _staff_shifts_from_payload(data):
        item = dict(raw)
        wd = str(item.get("work_date") or "").strip()[:10]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", wd):
            if len(dates) == 1:
                item["work_date"] = dates[0]
            elif re.match(r"^\d{4}-\d{2}-\d{2}$", sel):
                item["work_date"] = sel
        name = str(item.get("staff_member_name") or "").strip()
        if not name:
            hit = _match_member_name(text, member_names)
            if hit:
                item["staff_member_name"] = hit
        enriched.append(item)
    if not enriched and dates:
        h = suggest_staff_shift(text, member_names, context)
        if h.get("suggested_shifts"):
            return h
    out = dict(data)
    out["suggested_shifts"] = enriched
    out["suggested_fields"] = None
    return out


def is_staff_bulk_command(text: str) -> bool:
    """Comando che riguarda tutti i dipendenti e/o più giorni (lun-ven, settimana)."""
    lo = _normalize_for_match(text)
    return bool(
        re.search(
            r"(tutti|tutte|ogni\s+dipendente|tutti\s+i\s+dipendenti|tutto\s+il\s+personale|intero\s+staff)",
            lo,
        )
        or re.search(
            r"lunedi.*venerdi|lun.*ven|da\s+lunedi\s+a\s+venerdi|settimana|ogni\s+giorno",
            lo,
        )
    )


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
    """Compilazione locale turni (veloce, usa date settimana/giorno dalla UI)."""
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
    mentions_span = bool(
        all_kw
        or re.search(
            r"lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|lun.*ven|settimana|ogni\s+giorno",
            lo,
        )
    )
    if len(dates) > 1 and not mentions_span:
        sel = str(ctx.get("selected_date") or "")
        if re.match(r"^\d{4}-\d{2}-\d{2}$", sel) and sel in dates:
            dates = [sel]
        else:
            dates = [dates[0]]
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

