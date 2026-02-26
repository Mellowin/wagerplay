import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;
    
    const message = exception instanceof HttpException
      ? exception.getResponse()
      : exception instanceof Error
        ? exception.message
        : 'Unknown error';

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: typeof message === 'string' ? message : (message as any).message || message,
    };

    // Логируем детали ошибки
    this.logger.error(
      `[${request.method}] ${request.url} - ${status} | ${JSON.stringify(errorResponse.message)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // Дополнительное логирование для 500 ошибок
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('🔥 INTERNAL SERVER ERROR DETAILS:');
      this.logger.error(`Request body: ${JSON.stringify(request.body)}`);
      this.logger.error(`Request headers: ${JSON.stringify(request.headers)}`);
      this.logger.error(`Query params: ${JSON.stringify(request.query)}`);
    }

    response.status(status).json(errorResponse);
  }
}
