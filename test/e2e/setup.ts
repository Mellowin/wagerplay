import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { getRedisConnection } from './helpers/redis';

/**
 * Global setup for E2E tests
 * - Creates test app
 * - Cleans Redis (test DB)
 * - Ensures isolation
 */
async function setup() {
  console.log('[E2E Setup] Starting test environment...');

  // Create NestJS app
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  
  // Enable validation like in production
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  await app.init();

  // Clean Redis test DB
  const redis = getRedisConnection();
  await redis.flushdb();
  console.log('[E2E Setup] Redis flushed');

  // Store app reference for tests
  (global as any).__TEST_APP__ = app;

  console.log('[E2E Setup] Ready');
}

export default setup;
