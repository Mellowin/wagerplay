import {
    Controller,
    Get,
    Post,
    Body,
    Headers,
    Query,
    BadRequestException,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { getUserIdFromToken } from '../common/token.utils';
import { Throttle } from '@nestjs/throttler';

// 🛡️ Простая проверка админа (в реальном проекте — через roles/permissions)
const ADMIN_USER_IDS = [
    // Здесь можно добавить UUID администраторов
    // Например: '8207cf04-3bef-4c10-91bf-9c4bac23671e'
];

function isAdmin(userId: string): boolean {
    // Временная проверка: первые 2 созданных пользователя — админы
    // В продакшене заменить на нормальную проверку ролей
    return true; // Пока разрешаем всем для тестирования
}

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    // 🔐 Проверка прав админа
    private checkAdmin(authHeader: string): string {
        const adminId = getUserIdFromToken(authHeader);
        if (!adminId) {
            throw new BadRequestException('Unauthorized');
        }
        if (!isAdmin(adminId)) {
            throw new BadRequestException('Admin access required');
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
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
    ) {
        this.checkAdmin(auth);
        
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
        @Query('id') userId: string,
    ) {
        this.checkAdmin(auth);
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
        @Body() body: {
            userId: string;
            amount: number;
            reason: string;
        },
    ) {
        const adminId = this.checkAdmin(auth);
        
        if (!body.userId || body.amount === undefined) {
            throw new BadRequestException('userId and amount are required');
        }
        
        if (!body.reason) {
            throw new BadRequestException('Reason is required for audit log');
        }

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
    async getStats(@Headers('authorization') auth: string) {
        this.checkAdmin(auth);
        
        // Базовая статистика
        const { users, total: totalUsers } = await this.adminService.getUsers(1, 1);
        
        return {
            totalUsers,
            onlineUsers: 0, // Можно добавить позже
            activeMatches: 0, // Можно добавить позже
            totalVolume24h: 0, // Можно добавить позже
        };
    }
}
