import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MatchmakingService } from './matchmaking.service';
import { SubmitMoveDto } from './dto/submit-move.dto';
import { getUserIdFromToken } from '../common/token.utils';

@ApiTags('Matchmaking')
@ApiBearerAuth('JWT-auth')
@Controller('matchmaking')
export class MatchmakingController {
    constructor(private mm: MatchmakingService) { }

    @ApiOperation({ summary: 'Join matchmaking queue', description: 'Join queue for Rock Paper Scissors match' })
    @ApiResponse({ status: 200, description: 'Joined queue or match created' })
    @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 попыток за минуту
    @Post('quickplay')
    async quickplay(
        @Headers('authorization') auth: string,
        @Body() body: { playersCount: number; stakeVp: number },
    ) {
        const userId = getUserIdFromToken(auth);
        return this.mm.quickPlay(userId, body.playersCount, body.stakeVp);
    }

    @ApiOperation({ summary: 'Get match audit log', description: 'Returns financial audit for match' })
    @Get('match/:id/audit')
    async audit(@Param('id') id: string) {
        return this.mm.getAudit(id);
    }

    @Get('ticket/:id')
    async ticket(@Param('id') id: string, @Headers('authorization') auth: string) {
        const userId = getUserIdFromToken(auth);
        return this.mm.getTicketForUser(id, userId);
    }

    @Post('ticket/:id/fallback')
    async fallback(@Param('id') id: string) {
        return this.mm.fallbackToBotIfTimedOut(id);
    }

    @ApiOperation({ summary: 'Get match details', description: 'Returns match state by ID' })
    @Get('match/:id')
    async match(@Param('id') id: string) {
        return this.mm.getMatchOrThrow(id);
    }

    @ApiOperation({ summary: 'Submit move', description: 'Submit ROCK, PAPER or SCISSORS move' })
    @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 ходов за минуту
    @Post('match/:id/move')
    async move(
        @Param('id') id: string,
        @Headers('authorization') auth: string,
        @Body() body: SubmitMoveDto,
    ) {
        const userId = getUserIdFromToken(auth);
        return this.mm.submitMove(id, userId, body.move);
    }

    @Post('cleanup-orphaned')
    async cleanupOrphaned(@Body() body: { maxAgeMinutes?: number }) {
        const cleaned = await this.mm.cleanupOrphanedMatches(body.maxAgeMinutes || 10);
        return { cleaned, message: `Cleaned ${cleaned} orphaned matches` };
    }

    // 🧪 ТЕСТ: Создать фейковый зависший матч (только для разработки!)
    @Post('test-create-orphaned')
    async testCreateOrphaned(
        @Headers('authorization') auth: string,
        @Body() body: { stakeVp?: number }
    ) {
        const userId = getUserIdFromToken(auth);
        // Создаем матч с timestamp 15 минут назад
        const result = await this.mm.createTestOrphanedMatch(userId, body.stakeVp || 100);
        return result;
    }

    @ApiOperation({ summary: 'Get active state', description: 'Check if user is in queue or active match' })
    @Get('active')
    async getActiveState(@Headers('authorization') auth: string) {
        const userId = getUserIdFromToken(auth);
        if (!userId) {
            return { error: 'Unauthorized' };
        }
        return this.mm.getUserActiveState(userId);
    }

    @Get('online')
    async getOnlineCount() {
        return this.mm.getOnlineCount();
    }

    @ApiOperation({ summary: 'Get match history', description: 'Returns user\'s match history' })
    @Get('history')
    async getMatchHistory(
        @Headers('authorization') auth: string,
    ) {
        const userId = getUserIdFromToken(auth);
        if (!userId) {
            return { error: 'Unauthorized' };
        }
        return this.mm.getUserMatchHistory(userId);
    }

    @Post('test/force-match')
    async forceMatch(
        @Headers('authorization') auth: string,
        @Body() body: { playersCount: number; stakeVp: number },
    ) {
        const userId = getUserIdFromToken(auth);
        if (!userId) throw new BadRequestException('Unauthorized');
        
        // Only for testing - creates match immediately with force=true
        // Retry logic: wait for lock to be released and match to be created
        let attempts = 0;
        let result: string | null = null;
        
        while (attempts < 20 && !result) {  // 20 attempts = max 2 seconds
            result = await this.mm.tryAssembleMatch(body.playersCount, body.stakeVp, true);
            if (!result) {
                attempts++;
                await new Promise(r => setTimeout(r, 50));
            }
        }
        
        return { status: result ? 'OK' : 'FAILED', result, attempts };
    }

}
