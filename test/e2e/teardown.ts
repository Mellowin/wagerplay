import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Global teardown for E2E tests
 * - Closes app
 * - Cleanup Redis
 * - Cleanup resources
 */
async function teardown() {
  console.log('[E2E Teardown] Cleaning up...');

  // Close app
  const app = (global as any).__TEST_APP__;
  if (app) {
    await app.close();
    console.log('[E2E Teardown] App closed');
  }

  // Cleanup Redis connection
  const redis = new Redis(redisUrl);
  await redis.quit();
  console.log('[E2E Teardown] Redis disconnected');

  console.log('[E2E Teardown] Done');
}

export default teardown;
