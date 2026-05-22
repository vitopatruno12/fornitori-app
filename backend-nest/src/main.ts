import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = (process.env.CORS_ORIGINS || 'https://localhost:5173,https://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, credentials: true });
  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  console.log(`Nest AI service listening on https://localhost:${port} (TLS terminato dal proxy in produzione)`);
}
bootstrap();
