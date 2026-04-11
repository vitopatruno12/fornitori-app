import re
from datetime import datetime, timedelta
from typing import Any, Dict, List


def suggest_supplier_fields(text: str, existing_data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    t = (text or "").strip()
    lo = t.lower()
    out: Dict[str, Any] = {}

    first = t.split(",")[0].strip() if t else ""
    if first:
        out["name"] = first

    m_vat = re.search(r"(?:partita\s*iva|p\.?\s*iva|piva)\s*[:\s]*(?:it\s*)?([0-9\s]{9,13})", lo, re.I)
    if m_vat:
        out["vat_number"] = re.sub(r"\s+", "", m_vat.group(1))[-11:]

    m_email = re.search(r"([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})", lo, re.I)
    if m_email:
        out["email"] = m_email.group(1)

    m_phone = re.search(r"(?:telefono|tel|cellulare|cell)\s*[:\s]*([0-9+\s\-/.]{6,20})", t, re.I)
    if m_phone:
        out["phone"] = re.sub(r"[^\d+]", "", m_phone.group(1))[:15]

    m_city = re.search(r"(?:città|citta|city)\s*[:\s]*([a-zA-ZàèéìòùÀÈÉÌÒÙ'\s]{2,50})", t, re.I)
    if m_city:
        out["city"] = m_city.group(1).strip()

    if "bonifico" in lo:
        out["payment_terms"] = out.get("payment_terms") or "Bonifico"

    category = "altro"
    if any(k in lo for k in ["bevande", "acqua", "vino", "birra"]):
        category = "bevande"
    elif any(k in lo for k in ["luce", "gas", "acquedotto", "energia"]):
        category = "utenze"
    elif "manutenzione" in lo:
        category = "manutenzione"
    out["merchandise_category"] = category

    current = existing_data or {}
    merged = {**current, **out}
    missing = [k for k in ["name", "vat_number", "iban", "email", "payment_terms"] if not str(merged.get(k) or "").strip()]
    warnings = []
    if "pec" not in lo:
        warnings.append("PEC non rilevata nel testo")
    return {
        "suggested_fields": out,
        "missing_fields": missing,
        "warnings": warnings,
        "confidence": 0.82,
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

