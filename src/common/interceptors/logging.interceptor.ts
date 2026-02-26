import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, headers } = request;
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(2, 15);

    // Логируем входящий запрос
    this.logger.log(`[${requestId}] → ${method} ${url}`);
    
    if (Object.keys(body || {}).length > 0) {
      // Скрываем чувствительные данные
      const sanitizedBody = { ...body };
      if (sanitizedBody.password) sanitizedBody.password = '***';
      if (sanitizedBody.newPassword) sanitizedBody.newPassword = '***';
      if (sanitizedBody.token) sanitizedBody.token = sanitizedBody.token.substring(0, 10) + '...';
      this.logger.debug(`[${requestId}] Body: ${JSON.stringify(sanitizedBody)}`);
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          const duration = Date.now() - startTime;
          this.logger.log(`[${requestId}] ← ${method} ${url} | ${duration}ms`);
          if (response) {
            this.logger.debug(`[${requestId}] Response: ${JSON.stringify(response).substring(0, 500)}`);
          }
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logger.error(`[${requestId}] ✖ ${method} ${url} | ${duration}ms | ${error.message}`);
        },
      }),
    );
  }
}
