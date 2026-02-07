import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private logger = new Logger(EmailService.name);

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    if (host && user) {
      this.logger.log(`SMTP configured: ${user} via ${host}`);
    }
  }

  async sendVerificationEmail(to: string, token: string) {
    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    const verificationUrl = `${appUrl}/auth/verify-email?token=${token}`;
    
    // Логируем в консоль - письмо можно отправить вручную
    this.logger.log(`📧 ============================================`);
    this.logger.log(`📧 Verification email to: ${to}`);
    this.logger.log(`📧 URL: ${verificationUrl}`);
    this.logger.log(`📧 ============================================`);
  }

  async sendPasswordResetEmail(to: string, token: string) {
    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;
    
    this.logger.log(`📧 Password reset email to ${to}: ${resetUrl}`);
  }
}