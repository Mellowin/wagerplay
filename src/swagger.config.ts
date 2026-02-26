import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('WagerPlay API')
    .setDescription('Rock Paper Scissors betting game API')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Authentication', 'User registration and login')
    .addTag('Wallets', 'Balance and transactions')
    .addTag('Matchmaking', 'Game queue and matches')
    .addTag('Statistics', 'User stats and history')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // Сохраняем JSON для использования в кастомном UI
  const fs = require('fs');
  const path = require('path');
  const publicDir = path.join(process.cwd(), 'public');
  
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(publicDir, 'swagger.json'),
    JSON.stringify(document, null, 2),
  );
  
  // Также экспортируем для использования в контроллере
  return document;
}
