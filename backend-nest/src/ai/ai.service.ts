import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  ASK_AI,
  INVOICE_EXTRACT,
  ORDER_FULL_EXTRACT,
  ORDER_LINES_EXTRACT,
  PRIMA_NOTA_EXTRACT,
  STAFF_SHIFT_EXTRACT,
  SUPPLIER_EXTRACT,
} from './ai.prompts';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: GoogleGenerativeAI | null = null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('GEMINI_API_KEY', '').trim();
    if (key) {
      this.client = new GoogleGenerativeAI(key);
    } else {
      this.logger.warn('GEMINI_API_KEY mancante: endpoint AI non disponibili');
    }
  }

  private model() {
    if (!this.client) return null;
    const name = this.config.get<string>('GEMINI_MODEL', 'gemini-2.0-flash');
    return this.client.getGenerativeModel({
      model: name,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.15,
      },
    });
  }

  private static readonly QUOTA_MSG =
    'Quota Gemini esaurita (piano gratuito: circa 20 richieste/giorno per modello). ' +
    'Riprova domani, attiva billing su Google AI Studio, oppure usa compilazione locale.';

  private parseGeminiError(err: unknown): { quotaExceeded: boolean } {
    const msg = String(err);
    const quotaExceeded =
      msg.includes('429') ||
      msg.includes('Too Many Requests') ||
      msg.includes('quota') ||
      msg.includes('Quota exceeded');
    return { quotaExceeded };
  }

  private unavailablePayload(
    extra: Record<string, unknown>,
    quotaExceeded: boolean,
  ): Record<string, unknown> {
    return {
      ...extra,
      warnings: [quotaExceeded ? AiService.QUOTA_MSG : 'Servizio Gemini non disponibile'],
      confidence: 0,
      quota_exceeded: quotaExceeded,
    };
  }

  private async generateJson<T>(
    system: string,
    user: string,
  ): Promise<{ data: T | null; quotaExceeded: boolean }> {
    const m = this.model();
    if (!m) return { data: null, quotaExceeded: false };
    try {
      const result = await m.generateContent(`${system}\n\n${user}`);
      const raw = result.response.text()?.trim() ?? '';
      if (!raw) return { data: null, quotaExceeded: false };
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      return { data: JSON.parse(cleaned) as T, quotaExceeded: false };
    } catch (err) {
      const { quotaExceeded } = this.parseGeminiError(err);
      if (quotaExceeded) {
        this.logger.warn('Gemini quota exceeded (429) — uso fallback locale lato client/backend');
      } else {
        this.logger.warn(`Gemini error: ${err}`);
      }
      return { data: null, quotaExceeded };
    }
  }

  async suggestSupplierFields(text: string, existingData: Record<string, unknown> = {}) {
    const { data, quotaExceeded } = await this.generateJson<Record<string, unknown>>(
      SUPPLIER_EXTRACT,
      `Testo:\n${text}\n\nDati esistenti:\n${JSON.stringify(existingData)}`,
    );
    if (data) return data;
    return this.unavailablePayload({ suggested_fields: {}, missing_fields: ['name'] }, quotaExceeded);
  }

  async suggestPrimaNota(text: string, context: Record<string, unknown> = {}) {
    const { data, quotaExceeded } = await this.generateJson<Record<string, unknown>>(
      PRIMA_NOTA_EXTRACT,
      `Testo:\n${text}\n\nContesto:\n${JSON.stringify(context)}`,
    );
    if (data) return data;
    return this.unavailablePayload({ suggested_fields: {} }, quotaExceeded);
  }

  async suggestInvoice(text: string, existingData: Record<string, unknown> = {}) {
    const { data, quotaExceeded } = await this.generateJson<Record<string, unknown>>(
      INVOICE_EXTRACT,
      `Testo:\n${text}\n\nDati:\n${JSON.stringify(existingData)}`,
    );
    if (data) return data;
    return this.unavailablePayload({ suggested_fields: {} }, quotaExceeded);
  }

  async suggestOrderLines(text: string) {
    const { data, quotaExceeded } = await this.generateJson<Record<string, unknown>>(
      ORDER_LINES_EXTRACT,
      `Elenco:\n${text}`,
    );
    if (data) return data;
    return this.unavailablePayload({ suggested_lines: [] }, quotaExceeded);
  }

  async suggestStaffShift(
    text: string,
    memberNames: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    const { data, quotaExceeded } = await this.generateJson<Record<string, unknown>>(
      STAFF_SHIFT_EXTRACT,
      `Comando:\n${text}\n\nDipendenti:\n${memberNames.join(', ')}\n\nContesto:\n${JSON.stringify(context)}`,
    );
    if (data) return data;
    return this.unavailablePayload(
      { suggested_shifts: [], suggested_fields: {} },
      quotaExceeded,
    );
  }

  async suggestOrderFull(text: string, supplierNames: string[] = []) {
    const { data, quotaExceeded } = await this.generateJson<Record<string, unknown>>(
      ORDER_FULL_EXTRACT,
      `Testo:\n${text}\n\nFornitori:\n${supplierNames.join(', ')}`,
    );
    if (data) return data;
    return this.unavailablePayload(
      { suggested_fields: {}, suggested_lines: [] },
      quotaExceeded,
    );
  }

  checkAnomalies(entityType: string, payload: Record<string, unknown>) {
    const anomalies: string[] = [];
    const typ = (entityType || '').toLowerCase();
    if (typ === 'invoice') {
      const imponibile = Number(payload.imponibile ?? 0);
      const iva = Number(payload.vat_amount ?? payload.iva ?? 0);
      const totale = Number(payload.total ?? payload.totale ?? 0);
      if (Math.round((imponibile + iva) * 100) !== Math.round(totale * 100)) {
        anomalies.push('Totale non coerente con imponibile + IVA');
      }
      if (!payload.due_date) anomalies.push('Data scadenza mancante');
    }
    if (typ === 'supplier') {
      if (!String(payload.vat_number ?? '').trim()) anomalies.push('Partita IVA mancante');
    }
    if (typ === 'prima-nota' || typ === 'prima_nota' || typ === 'cash') {
      if (!String(payload.description ?? '').trim()) anomalies.push('Descrizione movimento mancante');
      if (Number(payload.amount ?? 0) <= 0) anomalies.push('Importo non valido');
    }
    return {
      has_anomalies: anomalies.length > 0,
      anomalies,
      severity: anomalies.length <= 1 ? 'low' : 'medium',
    };
  }

  async askAi(question: string, module = '', context: Record<string, unknown> = {}) {
    const { data, quotaExceeded } = await this.generateJson<Record<string, unknown>>(
      ASK_AI,
      `Modulo: ${module}\nDomanda: ${question}\nContesto: ${JSON.stringify(context)}`,
    );
    if (data) return data;
    return this.unavailablePayload(
      {
        answer: quotaExceeded
          ? AiService.QUOTA_MSG
          : 'Assistente AI non configurato. Imposta GEMINI_API_KEY.',
        suggested_actions: [],
      },
      quotaExceeded,
    );
  }
}
