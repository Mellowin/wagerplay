import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { UserStats } from '../users/user-stats.entity';
import { Wallet } from '../wallets/wallet.entity';
import { EmailService } from './email.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(UserStats) private userStatsRepo: Repository<UserStats>,
    @InjectRepository(Wallet) private walletsRepo: Repository<Wallet>,
    private emailService: EmailService,
    private audit: AuditService,
    private jwtService: JwtService,
  ) {}

  // Генерация случайного токена
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  // Хеширование пароля
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  // Проверка пароля (с fallback для старых SHA256 хешей)
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    // Проверяем bcrypt
    const isBcrypt = hash.startsWith('$2');
    if (isBcrypt) {
      return bcrypt.compare(password, hash);
    }
    // Fallback для старых SHA256 хешей (временно)
    const { createHash } = await import('crypto');
    const legacyHash = createHash('sha256').update(password + 'salt').digest('hex');
    return legacyHash === hash;
  }

  // Регистрация нового пользователя
  async register(email: string, password: string, username?: string) {
    // Нормализуем email (нижний регистр)
    const normalizedEmail = email.toLowerCase().trim();
    
    // Проверка существования email
    const existingUser = await this.usersRepo.findOne({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new BadRequestException('Email уже зарегистрирован');
    }

    // Создание пользователя
    const user = this.usersRepo.create({
      email: normalizedEmail,
      username: username || normalizedEmail.split('@')[0],
      displayName: username || normalizedEmail.split('@')[0],
      passwordHash: await this.hashPassword(password),
      verificationToken: this.generateToken(),
      emailVerified: false,
      isGuest: false,
      gender: null,
      avatarUrl: null,
    });

    await this.usersRepo.save(user);

    // Создание кошелька
    const wallet = this.walletsRepo.create({
      user,
      balanceWp: 10000,
      frozenWp: 0,
    });
    await this.walletsRepo.save(wallet);

    // Отправка письма подтверждения
    if (user.email && user.verificationToken) {
      try {
        await this.emailService.sendVerificationEmail(user.email, user.verificationToken);
      } catch (e) {
        console.error('Failed to send verification email:', e);
      }
    }

    return {
      userId: user.id,
      email: user.email,
      message: 'Регистрация успешна. Проверьте email для подтверждения.',
    };
  }

  // Подтверждение email
  async verifyEmail(token: string) {
    const user = await this.usersRepo.findOne({
      where: { verificationToken: token },
    });

    if (!user) {
      throw new BadRequestException('Неверный или истекший токен');
    }

    user.emailVerified = true;
    user.verificationToken = null;
    await this.usersRepo.save(user);

    return { message: 'Email успешно подтвержден' };
  }

  // Логин
  async login(email: string, password: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.usersRepo.findOne({
      where: { email: normalizedEmail },
      relations: { wallet: true },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const isPasswordValid = await this.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException('Email не подтвержден. Проверьте почту.');
    }

    // 🚫 Проверка бана
    if (user.isBanned) {
      throw new UnauthorizedException(`Аккаунт заблокирован. Причина: ${user.banReason || 'Нарушение правил'}`);
    }

    // Генерируем JWT token с подписью
    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return {
      userId: user.id,
      email: user.email,
      username: user.username,
      token,
      balanceWp: user.wallet?.balanceWp || 0,
    };
  }

  // Повторная отправка письма подтверждения
  async resendVerification(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.usersRepo.findOne({ where: { email: normalizedEmail } });
    
    if (!user) {
      return { message: 'Если email существует, письмо отправлено' };
    }

    if (user.emailVerified) {
      return { message: 'Email уже подтвержден' };
    }

    // Генерируем новый токен
    user.verificationToken = this.generateToken();
    await this.usersRepo.save(user);

    // Отправка письма
    if (user.email && user.verificationToken) {
      try {
        await this.emailService.sendVerificationEmail(user.email, user.verificationToken);
      } catch (e) {
        console.error('Failed to send verification email:', e);
      }
    }

    return { message: 'Письмо подтверждения отправлено' };
  }

  // Запрос на восстановление пароля
  async forgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.usersRepo.findOne({ where: { email: normalizedEmail } });
    
    if (!user) {
      // Не раскрываем, существует ли email
      return { message: 'Если email существует, письмо отправлено' };
    }

    user.resetToken = this.generateToken();
    user.resetTokenExpires = new Date(Date.now() + 3600000); // 1 час
    await this.usersRepo.save(user);

    // Отправка письма
    if (user.email && user.resetToken) {
      try {
        await this.emailService.sendPasswordResetEmail(user.email, user.resetToken);
      } catch (e) {
        console.error('Failed to send reset email:', e);
      }
    }

    return { message: 'Если email существует, письмо отправлено' };
  }

  // Проверка валидности токена сброса пароля
  async validateResetToken(token: string): Promise<boolean> {
    const user = await this.usersRepo.findOne({
      where: { resetToken: token },
    });
    return !!(user && user.resetTokenExpires && user.resetTokenExpires > new Date());
  }

  // Сброс пароля
  async resetPassword(token: string, newPassword: string) {
    const user = await this.usersRepo.findOne({
      where: { resetToken: token },
    });

    if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
      throw new BadRequestException('Неверный или истекший токен');
    }

    user.passwordHash = await this.hashPassword(newPassword);
    user.resetToken = null;
    user.resetTokenExpires = null;
    await this.usersRepo.save(user);

    return { message: 'Пароль успешно изменен' };
  }

  // Получение информации о пользователе
  async me(userId: string) {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: { wallet: true },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    // 🚫 Проверка бана
    if (user.isBanned) {
      throw new UnauthorizedException(`Аккаунт заблокирован. Причина: ${user.banReason || 'Нарушение правил'}`);
    }

    return {
      userId: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      gender: user.gender,
      avatarUrl: user.avatarUrl,
      isGuest: user.isGuest,
      emailVerified: user.emailVerified,
      balanceWp: user.wallet?.balanceWp || 0,
      frozenWp: user.wallet?.frozenWp || 0,
    };
  }

  // 👤 Публичный профиль пользователя (без приватных данных)
  async getPublicProfile(userId: string) {
    // Проверяем является ли userId валидным UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    
    let user: User | null = null;
    
    if (isUuid) {
      // Ищем по UUID
      user = await this.usersRepo.findOne({
        where: { id: userId },
      });
    }
    
    // Если не найден или не UUID - ищем по displayName
    if (!user && userId) {
      user = await this.usersRepo.findOne({
        where: { displayName: userId },
      });
    }

    if (!user) {
      throw new BadRequestException('Пользователь не найден');
    }

    // Загружаем статистику отдельно (используем найденный user.id)
    const stats = await this.userStatsRepo.findOne({ where: { userId: user.id } });

    return {
      id: user.id,
      displayName: user.displayName || 'Игрок',
      avatarUrl: user.avatarUrl,
      isGuest: user.isGuest,
      stats: {
        totalMatches: stats?.totalMatches || 0,
        wins: stats?.wins || 0,
        losses: stats?.losses || 0,
        winRate: stats?.winRate || 0,
      },
    };
  }

  // Обновление профиля
  async updateProfile(userId: string, data: { displayName?: string | null; gender?: 'male' | 'female' | '' | null; avatarUrl?: string | null }) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    // Validate and update displayName
    if (data.displayName !== undefined) {
      if (data.displayName !== null && typeof data.displayName !== 'string') {
        throw new BadRequestException('displayName должен быть строкой');
      }
      user.displayName = data.displayName === null ? null : data.displayName.trim().slice(0, 100);
    }

    // Validate and update gender
    if (data.gender !== undefined) {
      // Treat empty string as null (not selected)
      const genderValue = data.gender === '' ? null : data.gender;
      if (genderValue !== null && genderValue !== 'male' && genderValue !== 'female') {
        throw new BadRequestException("gender должен быть 'male', 'female' или null");
      }
      user.gender = genderValue;
    }

    // Validate and update avatarUrl
    if (data.avatarUrl !== undefined) {
      if (data.avatarUrl !== null && typeof data.avatarUrl !== 'string') {
        throw new BadRequestException('avatarUrl должен быть строкой');
      }
      // Allow data:image URLs (base64) and http(s) URLs
      if (data.avatarUrl !== null && data.avatarUrl.length > 0) {
        const isHttpUrl = data.avatarUrl.startsWith('http://') || data.avatarUrl.startsWith('https://');
        const isDataUrl = data.avatarUrl.startsWith('data:image/');
        if (!isHttpUrl && !isDataUrl) {
          throw new BadRequestException('avatarUrl должен быть http URL или data:image');
        }
        if (data.avatarUrl.length > 500000) {
          throw new BadRequestException('avatarUrl не должен превышать 500KB');
        }
      }
      user.avatarUrl = data.avatarUrl === null ? null : data.avatarUrl.trim() || null;
    }

    await this.usersRepo.save(user);

    return {
      userId: user.id,
      displayName: user.displayName,
      gender: user.gender,
      avatarUrl: user.avatarUrl,
      message: 'Профиль обновлен',
    };
  }

  // Привязка email для гостя
  async linkEmail(userId: string, email: string, password: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    if (!user.isGuest) {
      throw new BadRequestException('Email уже привязан');
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    // Проверка что email свободен
    const existing = await this.usersRepo.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      throw new BadRequestException('Email уже используется');
    }

    user.email = normalizedEmail;
    user.passwordHash = await this.hashPassword(password);
    user.isGuest = false;
    user.emailVerified = false;
    user.verificationToken = this.generateToken();

    await this.usersRepo.save(user);

    // Отправка письма подтверждения
    if (user.email && user.verificationToken) {
      try {
        await this.emailService.sendVerificationEmail(user.email, user.verificationToken);
      } catch (e) {
        console.error('Failed to send verification email:', e);
      }
    }

    return {
      userId: user.id,
      email: user.email,
      message: 'Email привязан. Проверьте почту для подтверждения.',
    };
  }

  // Guest login (оставляем для быстрого входа)
  async guestLogin() {
    const guestNumber = Math.floor(Math.random() * 10000);
    const user = this.usersRepo.create({
      username: `Guest${guestNumber}`,
      displayName: `Guest${guestNumber}`,
      isGuest: true,
      gender: null,
      avatarUrl: null,
    });
    await this.usersRepo.save(user);

    const wallet = this.walletsRepo.create({
      user,
      balanceWp: 10000,
      frozenWp: 0,
    });
    await this.walletsRepo.save(wallet);

    // Генерируем JWT токен для гостя (как для обычного пользователя)
    const token = this.jwtService.sign({ 
      userId: user.id, 
      isGuest: true,
      username: user.username,
    });
    
    return { 
      userId: user.id, 
      token: token, 
      balanceWp: wallet.balanceWp,
      isGuest: true,
      displayName: user.displayName,
    };
  }

  // 📊 Получение статистики игрока
  async getStats(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    const stats = await this.userStatsRepo.findOne({ where: { userId } });
    if (!stats) {
      // Если статистики нет - возвращаем нули
      return {
        totalMatches: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalWonVp: 0,
        totalLostVp: 0,
        totalStakedVp: 0,
        biggestWinVp: 0,
        biggestStakeVp: 0,
        winStreak: 0,
        maxWinStreak: 0,
      };
    }

    return {
      totalMatches: stats.totalMatches,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      totalWonVp: stats.totalWonVp,
      totalLostVp: stats.totalLostVp,
      totalStakedVp: stats.totalStakedVp,
      biggestWinVp: stats.biggestWinVp,
      biggestStakeVp: stats.biggestStakeVp,
      winStreak: stats.winStreak,
      maxWinStreak: stats.maxWinStreak,
    };
  }

  // 🆕 Получение audit логов пользователя
  async getAudit(userId: string) {
    const logs = await this.audit.getByUser(userId, 50);
    return {
      userId,
      count: logs.length,
      logs: logs.map(l => ({
        eventType: l.eventType,
        matchId: l.matchId,
        payload: l.payload,
        createdAt: l.createdAt,
      })),
    };
  }
}
