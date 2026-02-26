import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { setupSwagger } from './swagger.config';
import { SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Increase body size limit for avatar uploads
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    app.enableCors({
        origin: '*',
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        allowedHeaders: 'Content-Type, Authorization',
    });

    // Setup Swagger documentation
    const document = setupSwagger(app);
    SwaggerModule.setup('api/docs', app, document, {
        customSiteTitle: 'WagerPlay API Docs',
        customCss: '.swagger-ui .topbar { display: none }',
        swaggerOptions: {
            persistAuthorization: true,
        },
    });

    await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
    console.log(`Server running on http://0.0.0.0:${process.env.PORT ?? 3000}`);
    console.log(`API Documentation: http://0.0.0.0:${process.env.PORT ?? 3000}/api/docs`);
}
bootstrap();
