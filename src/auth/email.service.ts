import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(this.config.get<string>('SMTP_PORT') || '587'),
        secure: false, // true for 465, false for other ports
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false // для Gmail
        }
      });
      
      this.logger.log(`SMTP configured: ${user} via ${host}`);
      
      // Проверяем подключение
      this.transporter.verify((err) => {
        if (err) {
          this.logger.error(`SMTP verification failed: ${err.message}`);
        } else {
          this.logger.log('SMTP server is ready to send emails');
        }
      });
    } else {
      this.logger.warn('SMTP not configured - emails will be logged only');
    }
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const from = this.config.get<string>('SMTP_USER');
    
    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: `"WagerPlay" <${from}>`,
          to,
          subject,
          html,
        });
        this.logger.log(`Email sent to ${to}: ${subject}`);
      } catch (err) {
        this.logger.error(`Failed to send email to ${to}: ${err.message}`);
        throw err;
      }
    } else {
      // Fallback - логируем в консоль
      this.logger.log(`📧 ============================================`);
      this.logger.log(`📧 To: ${to}`);
      this.logger.log(`📧 Subject: ${subject}`);
      this.logger.log(`📧 ============================================`);
    }
  }

  async sendVerificationEmail(to: string, token: string) {
    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    const verificationUrl = `${appUrl}/auth/verify-email?token=${token}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">Подтверждение email</h2>
        <p>Здравствуйте!</p>
        <p>Спасибо за регистрацию в WagerPlay. Для подтверждения вашего email нажмите на кнопку ниже:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Подтвердить email
          </a>
        </div>
        <p>Или перейдите по ссылке:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p style="color: #666; font-size: 12px;">Если вы не регистрировались на WagerPlay, просто проигнорируйте это письмо.</p>
      </div>
    `;
    
    await this.sendEmail(to, 'Подтверждение регистрации WagerPlay', html);
  }

  async sendPasswordResetEmail(to: string, token: string) {
    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">Восстановление пароля</h2>
        <p>Здравствуйте!</p>
        <p>Вы запросили восстановление пароля для аккаунта WagerPlay. Нажмите на кнопку ниже для создания нового пароля:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" 
             style="background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Сбросить пароль
          </a>
        </div>
        <p>Или перейдите по ссылке:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p style="color: #666; font-size: 12px;">Ссылка действительна 1 час. Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.</p>
      </div>
    `;
    
    await this.sendEmail(to, 'Восстановление пароля WagerPlay', html);
  }
}
