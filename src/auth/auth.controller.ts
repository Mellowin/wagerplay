import { Controller, Post, Get, Headers } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  async guest() {
    return this.auth.guestLogin();
  }
  
    @Get('me')
  me(@Headers('authorization') authHeader?: string) {
    // ожидаем: "Bearer <token>"
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    return this.auth.me(token || '');
  }
}
