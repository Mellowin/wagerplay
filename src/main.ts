import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

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

    await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
    console.log(`Server running on http://0.0.0.0:${process.env.PORT ?? 3000}`);
}
bootstrap();
