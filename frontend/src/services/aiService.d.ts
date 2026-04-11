export function suggestSupplierFields(text: string, existingData?: Record<string, any>): Promise<any>;
export function suggestPrimaNota(text: string, context?: Record<string, any>): Promise<any>;
export function suggestInvoiceFields(text: string, existingData?: Record<string, any>): Promise<any>;
export function suggestOrderLines(text: string): Promise<{
  suggested_lines?: Array<{
    product_description?: string;
    pieces?: number | null;
    weight_kg?: number | string | null;
    note?: string | null;
  }>;
  warnings?: string[];
  confidence?: number;
}>;
export function checkAiAnomalies(entityType: string, payload: Record<string, any>, history?: Record<string, any>): Promise<any>;
export function askAi(question: string, module?: string, context?: Record<string, any>): Promise<any>;

