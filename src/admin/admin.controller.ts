import {
    Controller,
    Get,
    Post,
    Body,
    Headers,
    Query,
    BadRequestException,
    Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { getUserIdFromToken } from '../common/token.utils';
import { Throttle } from '@nestjs/throttler';

// 🛡️ Whitelist админов по email
const ADMIN_EMAILS = [
    'mellowin1987@gmail.com',
    'osanamyan@ukr.net',
];

// ⏱️ Таймаут админской сессии (30 минут)
const ADMIN_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    // 🔐 Проверка прав админа с IP и таймаутом
    private async checkAdmin(authHeader: string, clientIp: string): Promise<string> {
        const adminId = getUserIdFromToken(authHeader);
        if (!adminId) {
            throw new BadRequestException('Unauthorized');
        }

        const result = await this.adminService.validateAdminSession(
            adminId,
            clientIp,
            ADMIN_EMAILS,
            ADMIN_SESSION_TIMEOUT_MS,
        );

        if (!result.isValid) {
            throw new BadRequestException(result.error || 'Admin access required');
        }

        return adminId;
    }

    @ApiOperation({ summary: 'Get users list', description: 'List all users with pagination' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'search', required: false, type: String })
    @ApiResponse({ status: 200, description: 'Users list returned' })
    @ApiResponse({ status: 403, description: 'Admin access required' })
    @Get('users')
    async getUsers(
        @Headers('authorization') auth: string,
        @Ip() clientIp: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
    ) {
        await this.checkAdmin(auth, clientIp);
        
        return this.adminService.getUsers(
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
            search,
        );
    }

    @ApiOperation({ summary: 'Get user details', description: 'Get detailed info about specific user' })
    @ApiResponse({ status: 200, description: 'User details returned' })
    @Get('users/:id')
    async getUserDetails(
        @Headers('authorization') auth: string,
        @Ip() clientIp: string,
        @Query('id') userId: string,
    ) {
        await this.checkAdmin(auth, clientIp);
        return this.adminService.getUserDetails(userId);
    }

    @ApiOperation({ 
        summary: 'Update user balance', 
        description: 'Add or subtract balance from user wallet. Positive amount = add, negative = subtract.' 
    })
    @ApiResponse({ status: 200, description: 'Balance updated successfully' })
    @ApiResponse({ status: 400, description: 'Invalid amount or insufficient balance' })
    @ApiResponse({ status: 403, description: 'Admin access required' })
    @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 операций за минуту
    @Post('users/balance')
    async updateBalance(
        @Headers('authorization') auth: string,
        @Ip() clientIp: string,
        @Body() body: {
            userId: string;
            amount: number;
            reason: string;
        },
    ) {
        await this.checkAdmin(auth, clientIp);
        
        if (!body.userId || body.amount === undefined) {
            throw new BadRequestException('userId and amount are required');
        }
        
        if (!body.reason) {
            throw new BadRequestException('Reason is required for audit log');
        }

        const adminId = getUserIdFromToken(auth)!;

        return this.adminService.updateUserBalance(
            adminId,
            body.userId,
            body.amount,
            body.reason,
        );
    }

    @ApiOperation({ summary: 'Get admin dashboard stats', description: 'Overview statistics for admin panel' })
    @ApiResponse({ status: 200, description: 'Stats returned' })
    @Get('stats')
    async getStats(
        @Headers('authorization') auth: string,
        @Ip() clientIp: string,
    ) {
        await this.checkAdmin(auth, clientIp);
        
        // Базовая статистика
        const { users, total: totalUsers } = await this.adminService.getUsers(1, 1);
        
        return {
            totalUsers,
            onlineUsers: 0, // Можно добавить позже
            activeMatches: 0, // Можно добавить позже
            totalVolume24h: 0, // Можно добавить позже
        };
    }

    @ApiOperation({ 
        summary: 'Ban user', 
        description: 'Ban user with reason. Banned users cannot login or play.' 
    })
    @ApiResponse({ status: 200, description: 'User banned successfully' })
    @ApiResponse({ status: 400, description: 'Invalid request' })
    @ApiResponse({ status: 403, description: 'Admin access required' })
    @Throttle({ default: { limit: 20, ttl: 60000 } })
    @Post('users/ban')
    async banUser(
        @Headers('authorization') auth: string,
        @Ip() clientIp: string,
        @Body() body: {
            userId: string;
            reason: string;
        },
    ) {
        const adminId = await this.checkAdmin(auth, clientIp);
        
        if (!body.userId || !body.reason) {
            throw new BadRequestException('userId and reason are required');
        }

        return this.adminService.banUser(adminId, body.userId, body.reason);
    }

    @ApiOperation({ 
        summary: 'Unban user', 
        description: 'Remove ban from user.' 
    })
    @ApiResponse({ status: 200, description: 'User unbanned successfully' })
    @ApiResponse({ status: 400, description: 'Invalid request' })
    @ApiResponse({ status: 403, description: 'Admin access required' })
    @Throttle({ default: { limit: 20, ttl: 60000 } })
    @Post('users/unban')
    async unbanUser(
        @Headers('authorization') auth: string,
        @Ip() clientIp: string,
        @Body() body: {
            userId: string;
        },
    ) {
        const adminId = await this.checkAdmin(auth, clientIp);
        
        if (!body.userId) {
            throw new BadRequestException('userId is required');
        }

        return this.adminService.unbanUser(adminId, body.userId);
    }
}
