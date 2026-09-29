import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ensurePostgres } from './db/pg-bootstrap';

async function bootstrap() {
  await ensurePostgres();
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`现金服务中心 API: http://127.0.0.1:${port}/api`);
}
bootstrap();
