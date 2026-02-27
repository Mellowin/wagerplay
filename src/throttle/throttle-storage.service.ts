import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

interface StorageRecord {
    totalHits: number;
    timeToExpire: number;
}

export interface ThrottlerStorageRecord {
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
}

@Injectable()
export class ThrottlerStorageRedisService implements ThrottlerStorage {
    private redis: Redis;

    constructor(private config: ConfigService) {
        this.redis = new Redis({
            host: this.config.get<string>('REDIS_HOST') || 'localhost',
            port: Number(this.config.get<string>('REDIS_PORT') || 6379),
        });
    }

    async increment(
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string,
    ): Promise<ThrottlerStorageRecord> {
        const now = Date.now();
        const redisKey = `throttle:${throttlerName}:${key}`;
        
        // Получаем текущее значение
        const current = await this.redis.get(redisKey);
        let record: StorageRecord;
        
        if (current) {
            record = JSON.parse(current);
            // Проверяем, не истекло ли время
            if (record.timeToExpire < now) {
                // Сброс счетчика
                record = {
                    totalHits: 1,
                    timeToExpire: now + ttl,
                };
            } else {
                record.totalHits++;
            }
        } else {
            record = {
                totalHits: 1,
                timeToExpire: now + ttl,
            };
        }
        
        // Сохраняем в Redis с TTL
        const ttlSeconds = Math.ceil((record.timeToExpire - now) / 1000);
        await this.redis.setex(redisKey, ttlSeconds, JSON.stringify(record));
        
        return {
            totalHits: record.totalHits,
            timeToExpire: record.timeToExpire,
            isBlocked: record.totalHits > limit,
            timeToBlockExpire: record.totalHits > limit ? record.timeToExpire : 0,
        };
    }
}
