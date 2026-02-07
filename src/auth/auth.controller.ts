import { Controller, Post, Get, Patch, Body, Query, Headers, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

// Временно: токен = userId (в продакшене нужен JWT)
function getTokenUserId(authHeader?: string): string {
  if (!authHeader) return '';
  const s = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  return s.trim();
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Регистрация
  @Post('register')
  async register(@Body() body: { email: string; password: string; username?: string }) {
    if (!body.email || !body.password) {
      throw new BadRequestException('Email и пароль обязательны');
    }
    if (body.password.length < 6) {
      throw new BadRequestException('Пароль должен быть минимум 6 символов');
    }
    return this.auth.register(body.email, body.password, body.username);
  }

  // Подтверждение email
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('Токен обязателен');
    }
    return this.auth.verifyEmail(token);
  }

  // Логин
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    if (!body.email || !body.password) {
      throw new BadRequestException('Email и пароль обязательны');
    }
    return this.auth.login(body.email, body.password);
  }

  // Запрос на восстановление пароля
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    if (!body.email) {
      throw new BadRequestException('Email обязателен');
    }
    return this.auth.forgotPassword(body.email);
  }

  // Сброс пароля
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    if (!body.token || !body.newPassword) {
      throw new BadRequestException('Токен и новый пароль обязательны');
    }
    if (body.newPassword.length < 6) {
      throw new BadRequestException('Пароль должен быть минимум 6 символов');
    }
    return this.auth.resetPassword(body.token, body.newPassword);
  }

  // Получение информации о пользователе
  @Get('me')
  me(@Headers('authorization') authHeader?: string) {
    const token = getTokenUserId(authHeader);
    return this.auth.me(token);
  }

  // Guest login (для быстрого входа без регистрации)
  @Post('guest')
  guest() {
    return this.auth.guestLogin();
  }

  // Обновление профиля
  @Patch('profile')
  updateProfile(
    @Headers('authorization') authHeader: string,
    @Body() body: { displayName?: string | null; gender?: 'male' | 'female' | null; avatarUrl?: string | null },
  ) {
    const token = getTokenUserId(authHeader);
    if (!token) {
      throw new BadRequestException('Необходима авторизация');
    }
    return this.auth.updateProfile(token, body);
  }

  // Привязка email для гостя
  @Post('link-email')
  linkEmail(
    @Headers('authorization') authHeader: string,
    @Body() body: { email: string; password: string },
  ) {
    const token = getTokenUserId(authHeader);
    if (!token) {
      throw new BadRequestException('Необходима авторизация');
    }
    if (!body.email || !body.password) {
      throw new BadRequestException('Email и пароль обязательны');
    }
    if (body.password.length < 6) {
      throw new BadRequestException('Пароль должен быть минимум 6 символов');
    }
    return this.auth.linkEmail(token, body.email, body.password);
  }

  // 📊 Получение статистики игрока
  @Get('stats')
  async getStats(@Headers('authorization') authHeader: string) {
    const token = getTokenUserId(authHeader);
    if (!token) {
      throw new BadRequestException('Необходима авторизация');
    }
    return this.auth.getStats(token);
  }

  // Повторная отправка письма подтверждения
  @Post('resend-verification')
  async resendVerification(@Body() body: { email: string }) {
    if (!body.email) {
      throw new BadRequestException('Email обязателен');
    }
    return this.auth.resendVerification(body.email);
  }
}
