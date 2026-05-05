/**
 * Esempio equivalente a FastAPI POST /sdi/receive (app/routers/sdi.py).
 * Adatta guard (Bearer SDI_RECEIVE_TOKEN), servizio storage e entità TypeORM.
 */
import { Body, Controller, Headers, Post, Req, Res, HttpCode, UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';

@Controller('sdi')
export class SdiController {
  @Post('receive')
  @HttpCode(200)
  async receive(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
    @Headers('x-sdi-message-id') sdiMessageId?: string,
  ) {
    const expected = process.env.SDI_RECEIVE_TOKEN;
    if (expected && authorization !== `Bearer ${expected}`) {
      throw new UnauthorizedException();
    }
    const body: Buffer = req.body instanceof Buffer ? req.body : Buffer.from(req.body || '');
    if (!body.length) throw new BadRequestException('Corpo vuoto');
    const dedupeKey = createHash('sha256').update(body).digest('hex');
    // TODO: se esiste già dedupeKey -> { ok, duplicate: true, ... }
    // TODO: parse XML, salva file, insert metadati
    return res.json({ ok: true, duplicate: false, dedupe_key: dedupeKey, x_sdi_message_id: sdiMessageId || null });
  }
}
