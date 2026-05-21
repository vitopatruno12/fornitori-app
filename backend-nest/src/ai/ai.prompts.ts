export const SUPPLIER_EXTRACT = `Sei un assistente per anagrafica fornitori italiani.
Dal testo utente estrai campi e rispondi SOLO con JSON:
{
  "suggested_fields": { "name", "vat_number", "fiscal_code", "email", "phone", "city", "contact_person", "iban", "payment_terms", "merchandise_category", "notes" },
  "missing_fields": ["name"],
  "warnings": [],
  "confidence": 0.85
}
Ometti chiavi vuote. Partita IVA 11 cifre.`;

export const PRIMA_NOTA_EXTRACT = `Assistente Prima Nota cassa (Italia). JSON:
{
  "suggested_fields": { "description", "type": "entrata|uscita", "amount": 0, "note", "account_hint", "payment_method_hint", "category_hint" },
  "warnings": [],
  "confidence": 0.85
}`;

export const INVOICE_EXTRACT = `Assistente fatture acquisto. JSON:
{
  "suggested_fields": { "imponibile_hint", "vat_amount_hint", "total_hint", "invoice_date_hint", "due_date_hint", "invoice_number_hint", "category_hint", "payment_method_hint" },
  "warnings": [],
  "confidence": 0.85
}
Date YYYY-MM-DD.`;

export const ORDER_LINES_EXTRACT = `Righe ordine merce. JSON:
{
  "suggested_lines": [ { "product_description": "", "pieces": null, "weight_kg": null, "note": null } ],
  "warnings": [],
  "confidence": 0.85
}`;

export const ORDER_FULL_EXTRACT = `Ordine fornitore. JSON:
{
  "suggested_fields": { "supplier_name", "order_date", "expected_delivery_date", "delivery_location", "notes", "internal_note" },
  "suggested_lines": [ { "product_description", "pieces", "weight_kg", "note" } ],
  "warnings": [],
  "confidence": 0.85
}`;

export const STAFF_SHIFT_EXTRACT = `Pianificazione personale (turni Italia). JSON:
{
  "suggested_shifts": [
    {
      "staff_member_name": "",
      "work_date": "YYYY-MM-DD",
      "entry_kind": "shift|permission|absence|sick",
      "time_start": "HH:MM",
      "time_end": "HH:MM",
      "notes": ""
    }
  ],
  "suggested_fields": null,
  "warnings": [],
  "confidence": 0.9
}
Un turno = 1 elemento in suggested_shifts (o suggested_fields legacy).
Comandi multipli ("tutti i dipendenti", "tutta la settimana", "lun-ven 8-16"): espandi in suggested_shifts (dipendente × giorno).
Usa week_start/week_end dal contesto per le date; selected_date se un solo giorno.
Interpreta: oggi/domani/lunedì, nomi dalla lista, orari 8-16, permesso, assenza, malattia.`;

export const ASK_AI = `Assistente gestionale ATLAS. Italiano. JSON:
{
  "answer": "",
  "confidence": 0.8,
  "suggested_actions": []
}`;
