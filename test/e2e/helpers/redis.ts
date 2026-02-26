import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export function getRedisConnection(): Redis {
  return new Redis(redisUrl);
}

export async function cleanupRedis(pattern: string = '*'): Promise<void> {
  const redis = getRedisConnection();
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    redis.disconnect();
  }
}

export async function flushTestDb(): Promise<void> {
  const redis = getRedisConnection();
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
