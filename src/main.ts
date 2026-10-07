import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { validationPipe } from './common/http.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({ origin: process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()) ?? false });
  app.useGlobalPipes(validationPipe());
  app.enableShutdownHooks();
  if (process.env.API_DOCS_ENABLED === 'true') {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('LigaHub API').setDescription('Gestão de eventos de uma liga acadêmica.').setVersion('1.0').addBearerAuth().build());
    SwaggerModule.setup('docs', app, document);
  }
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
