import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle, SkipThrottle as NestSkipThrottle } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './custom-throttle.guard';

// Пропустить rate limiting (для health check и т.д.)
export const SkipThrottle = NestSkipThrottle;

// Строгий лимит: 10 запросов в минуту
export function StrictThrottle() {
    return applyDecorators(
        Throttle({ default: { limit: 10, ttl: 60000 } }),
        UseGuards(CustomThrottlerGuard),
    );
}

// Auth лимит: 5 запросов в 5 минут (для логина/регистрации)
export function AuthThrottle() {
    return applyDecorators(
        Throttle({ default: { limit: 5, ttl: 300000 } }),
        UseGuards(CustomThrottlerGuard),
    );
}

// Game лимит: 20 запросов в минуту (для игровых действий)
export function GameThrottle() {
    return applyDecorators(
        Throttle({ default: { limit: 20, ttl: 60000 } }),
        UseGuards(CustomThrottlerGuard),
    );
}

// API лимит: 100 запросов в минуту (для обычных API вызовов)
export function ApiThrottle() {
    return applyDecorators(
        Throttle({ default: { limit: 100, ttl: 60000 } }),
        UseGuards(CustomThrottlerGuard),
    );
}
