import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { getRedisConnection } from './redis';

/**
 * E2E Test Application Helper
 * 
 * Creates and configures NestJS app for E2E tests.
 * Used in beforeAll of each test file.
 */

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  
  // Enable validation like in production
  // forbidNonWhitelisted: false - allows mass assignment protection tests
  // (extra fields are stripped, not rejected)
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    exceptionFactory: (errors) => {
      // Format validation errors as a single string message for tests
      const messages = errors.map(e => Object.values(e.constraints || {})).flat();
      return new BadRequestException(messages.join(', '));
    },
  }));

  await app.init();

  // Clean Redis test DB
  const redis = getRedisConnection();
  await redis.flushdb();

  return app;
}

export async function closeTestApp(app: INestApplication): Promise<void> {
  if (app) {
    await app.close();
  }
  // Close Redis connection
  const redis = getRedisConnection();
  await redis.quit();
}
