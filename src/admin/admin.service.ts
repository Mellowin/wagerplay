import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { User } from '../users/user.entity';
import { Wallet } from '../wallets/wallet.entity';
import { UserStats } from '../users/user-stats.entity';
import { AuditService } from '../audit/audit.service';

export interface UserListItem {
    id: string;
    email: string | null;
    displayName: string | null;
    isGuest: boolean;
    isBanned: boolean;
    banReason: string | null;
    balanceWp: number;
    frozenWp: number;
    createdAt: Date;
    lastLoginAt: Date | null;
}

export interface BalanceUpdateResult {
    success: boolean;
    userId: string;
    oldBalance: number;
    newBalance: number;
    amount: number;
    reason: string;
}

export interface AdminSessionResult {
    isValid: boolean;
    error?: string;
}

@Injectable()
export class AdminService {
    constructor(
        @InjectRepository(User)
        private userRepo: Repository<User>,
        @InjectRepository(Wallet)
        private walletRepo: Repository<Wallet>,
        @InjectRepository(UserStats)
        private statsRepo: Repository<UserStats>,
        private audit: AuditService,
        private dataSource: DataSource,
    ) {}

    // 🛡️ Проверка админской сессии (IP + таймаут)
    async validateAdminSession(
        userId: string,
        clientIp: string,
        adminEmails: string[],
        timeoutMs: number,
    ): Promise<AdminSessionResult> {
        const user = await this.userRepo.findOne({ where: { id: userId } });

        if (!user) {
            return { isValid: false, error: 'User not found' };
        }

        // Проверка email в whitelist
        if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
            return { isValid: false, error: 'Admin access required' };
        }

        // Проверка/установка IP админа
        if (!user.adminIp) {
            // Первый вход - сохраняем IP
            user.adminIp = clientIp;
            await this.userRepo.save(user);
            console.log(`[Admin] First login from IP ${clientIp} for ${user.email}`);
        } else if (user.adminIp !== clientIp) {
            // IP не совпадает
            return { 
                isValid: false, 
                error: `Access denied: IP mismatch. Expected: ${user.adminIp}, got: ${clientIp}` 
            };
        }

        // Проверка таймаута сессии
        if (user.lastAdminActivity) {
            const inactiveTime = Date.now() - new Date(user.lastAdminActivity).getTime();
            if (inactiveTime > timeoutMs) {
                return { 
                    isValid: false, 
                    error: `Session expired due to inactivity (${Math.round(inactiveTime / 60000)} min)` 
                };
            }
        }

        // Обновляем время последней активности
        user.lastAdminActivity = new Date();
        await this.userRepo.save(user);

        return { isValid: true };
    }

    // 📝 Получить список пользователей с пагинацией
    async getUsers(
        page: number = 1,
        limit: number = 20,
        search?: string,
    ): Promise<{ users: UserListItem[]; total: number }> {
        const query = this.userRepo.createQueryBuilder('user')
            .leftJoinAndSelect('user.wallet', 'wallet')
            .orderBy('user.createdAt', 'DESC')
            .skip((page - 1) * limit)
            .take(limit);

        if (search) {
            query.where(
                '(user.email ILIKE :search OR user.displayName ILIKE :search)',
                { search: `%${search}%` },
            );
        }

        const [users, total] = await query.getManyAndCount();

        return {
            users: users.map(user => ({
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                isGuest: !user.email,
                isBanned: user.isBanned,
                banReason: user.banReason,
                balanceWp: user.wallet?.balanceWp || 0,
                frozenWp: user.wallet?.frozenWp || 0,
                createdAt: user.createdAt,
                lastLoginAt: null,
            })),
            total,
        };
    }

    // 💰 Изменить баланс пользователя
    async updateUserBalance(
        adminId: string,
        targetUserId: string,
        amount: number,
        reason: string,
    ): Promise<BalanceUpdateResult> {
        if (amount === 0) {
            throw new BadRequestException('Amount cannot be zero');
        }

        return this.dataSource.transaction(async (manager) => {
            // Находим пользователя
            const user = await manager.findOne(User, {
                where: { id: targetUserId },
                relations: { wallet: true },
            });

            if (!user) {
                throw new NotFoundException('User not found');
            }

            if (!user.wallet) {
                throw new NotFoundException('User wallet not found');
            }

            const oldBalance = user.wallet.balanceWp;
            const newBalance = oldBalance + amount;

            // Проверяем, что баланс не уйдет в минус
            if (newBalance < 0) {
                throw new BadRequestException(
                    `Insufficient balance. Current: ${oldBalance}, requested: ${amount}`
                );
            }

            // Обновляем баланс
            user.wallet.balanceWp = newBalance;
            await manager.save(user.wallet);

            // Логируем в audit
            await this.audit.log({
                eventType: 'ADMIN_BALANCE_UPDATE',
                matchId: null,
                actorId: adminId,
                payload: {
                    targetUserId,
                    oldBalance,
                    newBalance,
                    amount,
                    reason,
                    adminId,
                },
            });

            console.log(`[Admin] Balance updated for ${targetUserId.slice(0,8)}: ${oldBalance} → ${newBalance} (${amount > 0 ? '+' : ''}${amount})`);

            return {
                success: true,
                userId: targetUserId,
                oldBalance,
                newBalance,
                amount,
                reason,
            };
        });
    }

    // 🔍 Получить детали пользователя
    async getUserDetails(userId: string): Promise<{
        user: User;
        wallet: Wallet | null;
        stats: UserStats | null;
    }> {
        const user = await this.userRepo.findOne({
            where: { id: userId },
            relations: { wallet: true },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        const stats = await this.statsRepo.findOne({
            where: { userId },
        });

        return {
            user,
            wallet: user.wallet || null,
            stats,
        };
    }

    // 🚫 Забанить пользователя
    async banUser(
        adminId: string,
        targetUserId: string,
        reason: string,
    ): Promise<{ success: boolean; userId: string; isBanned: boolean; reason: string }> {
        const user = await this.userRepo.findOne({
            where: { id: targetUserId },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (user.isBanned) {
            throw new BadRequestException('User is already banned');
        }

        // Устанавливаем бан
        user.isBanned = true;
        user.banReason = reason;
        user.bannedBy = adminId;
        user.bannedAt = new Date();
        await this.userRepo.save(user);

        // Логируем в audit
        await this.audit.log({
            eventType: 'ADMIN_USER_BAN',
            matchId: null,
            actorId: adminId,
            payload: { targetUserId, reason, bannedAt: user.bannedAt },
        });

        console.log(`[Admin] User ${targetUserId.slice(0, 8)} banned by ${adminId.slice(0, 8)}. Reason: ${reason}`);

        return {
            success: true,
            userId: targetUserId,
            isBanned: true,
            reason,
        };
    }

    // ✅ Разбанить пользователя
    async unbanUser(
        adminId: string,
        targetUserId: string,
    ): Promise<{ success: boolean; userId: string; isBanned: boolean }> {
        const user = await this.userRepo.findOne({
            where: { id: targetUserId },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (!user.isBanned) {
            throw new BadRequestException('User is not banned');
        }

        // Снимаем бан
        user.isBanned = false;
        user.banReason = null;
        user.bannedBy = null;
        user.bannedAt = null;
        await this.userRepo.save(user);

        // Логируем в audit
        await this.audit.log({
            eventType: 'ADMIN_USER_UNBAN',
            matchId: null,
            actorId: adminId,
            payload: { targetUserId, unbannedAt: new Date() },
        });

        console.log(`[Admin] User ${targetUserId.slice(0, 8)} unbanned by ${adminId.slice(0, 8)}`);

        return {
            success: true,
            userId: targetUserId,
            isBanned: false,
        };
    }
}
