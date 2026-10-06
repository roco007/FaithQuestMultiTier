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

  // An explicit origin list by default. With `credentials: true` the server must
  // echo one concrete origin — a literal "*" makes browsers reject the response
  // ("must not be the wildcard ... when the request's credentials mode is
  // 'include'"). Unknown origins simply get no CORS headers, so the browser
  // blocks them.
  const origins = config.get<string[]>('corsOrigins') ?? [];
  const allowAnyOrigin = origins.includes('*');

  app.enableCors({
    origin: ((
      origin: string | undefined,
      callback: (err: Error | null, allowed?: boolean | string) => void,
    ) => {
      // Same-origin / curl / mobile clients send no Origin — always allow.
      if (!origin) return callback(null, true);
      // The wildcard case has to *reflect* the caller's origin rather than send
      // "*" back: credentials mode is "include" (see below), and browsers reject a
      // wildcard Access-Control-Allow-Origin in that mode. Echoing the exact
      // origin is what makes an open policy actually work.
      if (allowAnyOrigin) return callback(null, origin);
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
  if (allowAnyOrigin) {
    // An open CORS policy is easy to leave behind and hard to notice, so it is
    // announced on every boot rather than buried in a config comment. Note the
    // asymmetry with cookies: this app authenticates with a Bearer token in the
    // Authorization header, which a browser will not attach to a request made on
    // another site's behalf — so "*" does not by itself hand over a session.
    logger.warn(
      'CORS: allowing ALL origins (CORS_ORIGIN contains "*"). Any site can call this API.',
    );
  }
  logger.log(`CORS origins: ${origins.join(', ')}`);
}

void bootstrap();