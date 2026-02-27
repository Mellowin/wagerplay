import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { LeaderboardService, type LeaderboardCategory, type LeaderboardEntry } from './leaderboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkipThrottle } from '../throttle/throttle.decorators';

@ApiTags('Leaderboard')
@Controller('leaderboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@SkipThrottle() // Skip rate limiting for leaderboard
export class LeaderboardController {
    constructor(private readonly leaderboardService: LeaderboardService) {}

    @Get()
    @ApiOperation({ summary: 'Get leaderboard by category', description: 'Returns top players sorted by specified category' })
    @ApiQuery({ name: 'category', enum: ['wins', 'winRate', 'profit', 'streak', 'biggestWin'], required: false, description: 'Sort category' })
    @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Number of results (default: 10, max: 100)' })
    @ApiQuery({ name: 'offset', type: Number, required: false, description: 'Offset for pagination (default: 0)' })
    @ApiResponse({ status: 200, description: 'Leaderboard entries' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    async getLeaderboard(
        @Query('category') category: LeaderboardCategory = 'wins',
        @Query('limit') limit: string = '10',
        @Query('offset') offset: string = '0',
    ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
        const limitNum = Math.min(parseInt(limit) || 10, 100);
        const offsetNum = parseInt(offset) || 0;
        
        return this.leaderboardService.getLeaderboard(category, limitNum, offsetNum);
    }

    @Get('global')
    @ApiOperation({ 
        summary: 'Get global leaderboard', 
        description: 'Returns top players from all categories for main page' 
    })
    @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Number of results per category (default: 5)' })
    @ApiResponse({ status: 200, description: 'Leaderboard by all categories' })
    async getGlobalLeaderboard(
        @Query('limit') limit: string = '5',
    ): Promise<Record<LeaderboardCategory, LeaderboardEntry[]>> {
        const limitNum = Math.min(parseInt(limit) || 5, 20);
        return this.leaderboardService.getGlobalLeaderboard(limitNum);
    }

    @Get('me')
    @ApiOperation({ 
        summary: 'Get current user position', 
        description: 'Returns authenticated user\'s rank in leaderboard' 
    })
    @ApiQuery({ name: 'category', enum: ['wins', 'winRate', 'profit', 'streak', 'biggestWin'], required: false, description: 'Category' })
    @ApiResponse({ status: 200, description: 'User position' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    async getMyPosition(
        @CurrentUser('userId') userId: string,
        @Query('category') category: LeaderboardCategory = 'wins',
    ): Promise<LeaderboardEntry | null> {
        return this.leaderboardService.findUserPosition(userId, category);
    }

    @Get('user/:userId')
    @ApiOperation({ 
        summary: 'Get user position', 
        description: 'Returns specific user\'s position' 
    })
    @ApiQuery({ name: 'category', enum: ['wins', 'winRate', 'profit', 'streak', 'biggestWin'], required: false, description: 'Category' })
    @ApiResponse({ status: 200, description: 'User position' })
    @ApiResponse({ status: 404, description: 'User not found' })
    async getUserPosition(
        @Param('userId') userId: string,
        @Query('category') category: LeaderboardCategory = 'wins',
    ): Promise<LeaderboardEntry | null> {
        return this.leaderboardService.findUserPosition(userId, category);
    }

    @Get('categories')
    @ApiOperation({ summary: 'Get available leaderboard categories' })
    @ApiResponse({ status: 200, description: 'List of categories' })
    getCategories(): { categories: { id: LeaderboardCategory; name: string; description: string }[] } {
        return {
            categories: [
                { id: 'wins', name: 'Most Wins', description: 'Players with most victories' },
                { id: 'winRate', name: 'Best Win Rate', description: 'Highest win percentage (min 10 matches)' },
                { id: 'profit', name: 'Most VP Won', description: 'Total VP earned from matches' },
                { id: 'streak', name: 'Current Streak', description: 'Longest current win streak' },
                { id: 'biggestWin', name: 'Max Streak', description: 'All-time longest win streak' },
            ],
        };
    }
}
