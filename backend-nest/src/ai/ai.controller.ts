import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('suppliers/suggest')
  suggestSupplier(
    @Body() body: { text: string; existing_data?: Record<string, unknown> },
  ) {
    return this.ai.suggestSupplierFields(body.text, body.existing_data ?? {});
  }

  @Post('prima-nota/suggest')
  suggestPrimaNota(@Body() body: { text: string; context?: Record<string, unknown> }) {
    return this.ai.suggestPrimaNota(body.text, body.context ?? {});
  }

  @Post('invoices/suggest')
  suggestInvoice(
    @Body() body: { text: string; existing_data?: Record<string, unknown> },
  ) {
    return this.ai.suggestInvoice(body.text, body.existing_data ?? {});
  }

  @Post('orders/suggest')
  suggestOrder(@Body() body: { text: string }) {
    return this.ai.suggestOrderLines(body.text);
  }

  @Post('staff/shift-suggest')
  suggestStaffShift(
    @Body() body: { text: string; member_names?: string[]; context?: Record<string, unknown> },
  ) {
    return this.ai.suggestStaffShift(body.text, body.member_names ?? [], body.context ?? {});
  }

  @Post('orders/suggest-full')
  suggestOrderFull(
    @Body() body: { text: string; supplier_names?: string[] },
  ) {
    return this.ai.suggestOrderFull(body.text, body.supplier_names ?? []);
  }

  @Post('anomalies/check')
  checkAnomalies(
    @Body()
    body: {
      entity_type: string;
      payload: Record<string, unknown>;
      history?: Record<string, unknown>;
    },
  ) {
    return this.ai.checkAnomalies(body.entity_type, body.payload);
  }

  @Post('ask')
  askAi(
    @Body()
    body: {
      question: string;
      module?: string;
      context?: Record<string, unknown>;
    },
  ) {
    return this.ai.askAi(body.question, body.module ?? '', body.context ?? {});
  }
}
