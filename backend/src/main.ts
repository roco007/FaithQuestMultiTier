import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { validateEnvironment } from './config/validation.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

/** Every route lives under `/api/v1`; Swagger is served outside that prefix. */
const API_PREFIX = 'api/v1';
const SWAGGER_PATH = 'api/docs';

async function bootstrap(): Promise<void> {
  // Fail before Nest starts if the environment is unusable — see validation.ts.
  validateEnvironment();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties, and reject requests that send them: the quest
      // completion endpoint relies on this to make `{ xp: 5000 }` a 400 rather
      // than something that is quietly ignored.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // One error envelope for every failure (rule #9).
  app.useGlobalFilters(new AllExceptionsFilter());

  // Rule #24: an explicit origin list, never "*". With `credentials: true`
  // the server must echo one concrete origin — "*" or a bare `true` makes
  // browsers reject the response ("must not be the wildcard ... when the
  // request's credentials mode is 'include'"). Unknown origins simply get no
  // CORS headers, so the browser blocks them.
  const origins = config.get<string[]>('corsOrigins') ?? [];
  app.enableCors({
    origin: ((
      origin: string | undefined,
      callback: (err: Error | null, allowed?: boolean) => void,
    ) => {
      // Same-origin / curl / mobile clients send no Origin — always allow.
      if (!origin) return callback(null, true);
      callback(null, origins.includes(origin));
    }) as never,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  if (config.get<string>('nodeEnv') !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('FaithQuest API')
        .setDescription(
          'FaithQuest backend — users, quests, hunts, XP, badges, inventory and leaderboard.',
        )
        .setVersion('1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'bearer',
        )
        .addServer('/')
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get<number>('port') ?? 3001;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`FaithQuest API listening on http://localhost:${port}/${API_PREFIX}`);
  if (config.get<string>('nodeEnv') !== 'production') {
    logger.log(`Swagger UI: http://localhost:${port}/${SWAGGER_PATH}`);
  }
  logger.log(`CORS origins: ${origins.join(', ') || '(reflecting request origin)'}`);
}

void bootstrap();