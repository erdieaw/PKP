import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getConfig } from './config';
import { ApiExceptionFilter, ApiResponseInterceptor } from './core/http';

export async function createApp() {
  const config = getConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.set('trust proxy', config.trustedProxyIps.length ? config.trustedProxyIps : false);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });
  app.enableCors({ origin: config.frontendUrl, credentials: false });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
    transform: true, transformOptions: { enableImplicitConversion: false },
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableShutdownHooks();
  if (process.env.ENABLE_SWAGGER === 'true') {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle('SIPKP API').setVersion('1.0').addBearerAuth().build());
    SwaggerModule.setup('api/docs', app, document);
  }
  return app;
}

if (require.main === module) {
  void (async () => {
    const app = await createApp();
    await app.listen(getConfig().port, '0.0.0.0');
  })().catch(() => { console.error('Application startup failed'); process.exitCode = 1; });
}
