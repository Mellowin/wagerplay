import { Controller, Post, Get, Patch, Body, Query, Headers, BadRequestException, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Декодирует JWT и возвращает userId из 'sub' claim
// Поддерживает как JWT токены, так и plain UUID (для обратной совместимости)
function getUserIdFromToken(authHeader?: string): string {
  if (!authHeader) return '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const trimmed = token.trim();
  
  // Если это plain UUID (гостевой токен), возвращаем как есть
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(trimmed)) {
    return trimmed;
  }
  
  // Иначе пробуем декодировать как JWT
  try {
    const base64Payload = trimmed.split('.')[1];
    if (!base64Payload) return '';
    const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
    return payload.sub || '';
  } catch {
    return '';
  }
}

@ApiTags('Authentication')
@ApiBearerAuth('JWT-auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: 'Register new user', description: 'Create account with email and password' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Email and password are required' })
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 попыток за 5 минут
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

  @ApiOperation({ summary: 'Login user', description: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful, returns JWT token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 попыток за 5 минут
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    if (!body.email || !body.password) {
      throw new BadRequestException('Email и пароль обязательны');
    }
    return this.auth.login(body.email, body.password);
  }

  // Запрос на восстановление пароля
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 попытки за час
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    if (!body.email) {
      throw new BadRequestException('Email обязателен');
    }
    return this.auth.forgotPassword(body.email);
  }

  // Отображение формы сброса пароля (GET)
  @Get('reset-password')
  async resetPasswordPage(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('Токен обязателен');
    }
    // Проверяем валидность токена
    const isValid = await this.auth.validateResetToken(token);
    if (!isValid) {
      return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Ошибка</title></head>
<body style="font-family: Arial; text-align: center; padding: 50px;">
  <h2 style="color: #e74c3c;">❌ Ссылка недействительна или истекла</h2>
  <p>Запросите восстановление пароля снова.</p>
  <a href="/ws-test.html" style="color: #4F46E5;">Вернуться к игре</a>
</body></html>`;
    }
    
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Сброс пароля - WagerPlay</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 30px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    h2 { color: #fff; margin: 0 0 20px; text-align: center; }
    .logo { text-align: center; font-size: 40px; margin-bottom: 10px; }
    .password-field {
      position: relative;
      margin-bottom: 15px;
    }
    input {
      width: 100%;
      padding: 12px 40px 12px 16px;
      border: none;
      border-radius: 8px;
      background: rgba(255,255,255,0.1);
      color: #fff;
      font-size: 16px;
    }
    input::placeholder { color: rgba(255,255,255,0.5); }
    .password-toggle {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.2em;
      opacity: 0.7;
      transition: opacity 0.2s;
      padding: 5px;
      color: #fff;
    }
    .password-toggle:hover { opacity: 1; }
    button[type="submit"] {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #4F46E5 0%, #7c3aed 100%);
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button[type="submit"]:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(79, 70, 229, 0.4); }
    button[type="submit"]:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .message { 
      text-align: center; 
      margin-top: 15px; 
      padding: 10px;
      border-radius: 8px;
      display: none;
    }
    .message.success { background: rgba(34, 197, 94, 0.2); color: #4ade80; display: block; }
    .message.error { background: rgba(239, 68, 68, 0.2); color: #f87171; display: block; }
    .back-link { 
      display: block; 
      text-align: center; 
      margin-top: 20px; 
      color: rgba(255,255,255,0.6); 
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🔐</div>
    <h2>Новый пароль</h2>
    <form id="resetForm">
      <div class="password-field">
        <input type="password" id="password" placeholder="Введите новый пароль" minlength="6" required>
        <button type="button" class="password-toggle" onclick="togglePassword('password', this)">👁️</button>
      </div>
      <div class="password-field">
        <input type="password" id="confirm" placeholder="Подтвердите пароль" minlength="6" required>
        <button type="button" class="password-toggle" onclick="togglePassword('confirm', this)">👁️</button>
      </div>
      <button type="submit" id="submitBtn">Сохранить пароль</button>
    </form>
    <div id="message" class="message"></div>
    <a href="/ws-test.html" class="back-link">← Вернуться к игре</a>
  </div>
  <script>
    const token = '${token}';
    
    function togglePassword(inputId, btn) {
      const input = document.getElementById(inputId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    }
    
    // Enter key handler
    document.getElementById('password').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('confirm').focus();
      }
    });
    document.getElementById('confirm').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('resetForm').dispatchEvent(new Event('submit'));
      }
    });
    
    document.getElementById('resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm').value;
      const msgEl = document.getElementById('message');
      const btn = document.getElementById('submitBtn');
      
      if (password !== confirm) {
        msgEl.className = 'message error';
        msgEl.textContent = '❌ Пароли не совпадают';
        return;
      }
      if (password.length < 6) {
        msgEl.className = 'message error';
        msgEl.textContent = '❌ Пароль минимум 6 символов';
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Сохраняем...';
      
      try {
        const res = await fetch('/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword: password })
        });
        const data = await res.json();
        
        if (res.ok) {
          msgEl.className = 'message success';
          msgEl.innerHTML = '✅ Пароль изменён!<br><a href="/ws-test.html" style="color: #4ade80;">Войти в игру</a>';
          document.getElementById('resetForm').style.display = 'none';
        } else {
          msgEl.className = 'message error';
          msgEl.textContent = '❌ ' + (data.message || 'Ошибка');
          btn.disabled = false;
          btn.textContent = 'Сохранить пароль';
        }
      } catch (err) {
        msgEl.className = 'message error';
        msgEl.textContent = '❌ Ошибка соединения';
        btn.disabled = false;
        btn.textContent = 'Сохранить пароль';
      }
    });
  </script>
</body>
</html>`;
  }

  // Сброс пароля (POST)
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
    const token = getUserIdFromToken(authHeader);
    return this.auth.me(token);
  }

  // Guest login (для быстрого входа без регистрации)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 гостевых входов за минуту
  @Post('guest')
  guest() {
    return this.auth.guestLogin();
  }

  // Обновление профиля
  @Patch('profile')
  updateProfile(
    @Headers('authorization') authHeader: string,
    @Body() body: UpdateProfileDto,
  ) {
    const token = getUserIdFromToken(authHeader);
    if (!token) {
      throw new BadRequestException('Необходима авторизация');
    }
    // Additional validation for empty/whitespace displayName
    if (body.displayName !== undefined && body.displayName.trim() === '') {
      throw new BadRequestException('Display name cannot be empty');
    }
    return this.auth.updateProfile(token, body);
  }

  // 👤 Публичный профиль пользователя (для просмотра чужих профилей)
  @Get('public-profile/:userId')
  async getPublicProfile(@Param('userId') userId: string) {
    return this.auth.getPublicProfile(userId);
  }

  // Привязка email для гостя
  @Post('link-email')
  linkEmail(
    @Headers('authorization') authHeader: string,
    @Body() body: { email: string; password: string },
  ) {
    const token = getUserIdFromToken(authHeader);
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
    const token = getUserIdFromToken(authHeader);
    if (!token) {
      throw new BadRequestException('Необходима авторизация');
    }
    return this.auth.getStats(token);
  }

  // 🆕 Получение audit логов пользователя (для отладки)
  @Get('audit')
  async getAudit(@Headers('authorization') authHeader: string) {
    const token = getUserIdFromToken(authHeader);
    if (!token) {
      throw new BadRequestException('Необходима авторизация');
    }
    return this.auth.getAudit(token);
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
