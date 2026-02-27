import { Injectable, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
    // Получаем IP адрес из запроса
    protected async getTracker(req: Record<string, any>): Promise<string> {
        const request = req as Request;
        // Используем IP + User-Agent для лучшей идентификации
        const ip = request.ip || 
                   request.headers['x-forwarded-for'] as string || 
                   request.socket.remoteAddress || 
                   'unknown';
        const userAgent = request.headers['user-agent'] || 'unknown';
        return `${ip}:${userAgent.slice(0, 20)}`;
    }

    // Кастомное сообщение об ошибке
    protected async throwThrottlingException(
        context: ExecutionContext,
        throttlerLimitDetail: { limit: number; ttl: number; key: string }
    ): Promise<void> {
        const request = context.switchToHttp().getRequest<Request>();
        const endpoint = request.route?.path || request.url;
        
        throw new HttpException(
            {
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                message: 'Rate limit exceeded',
                error: 'Too Many Requests',
                details: {
                    limit: throttlerLimitDetail.limit,
                    window: `${throttlerLimitDetail.ttl / 1000} seconds`,
                    endpoint,
                    retryAfter: Math.ceil(throttlerLimitDetail.ttl / 1000),
                },
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
}
