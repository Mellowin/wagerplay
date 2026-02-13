import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';

function getTokenUserId(authHeader?: string): string {
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

@Controller('matchmaking')
export class MatchmakingController {
    constructor(private mm: MatchmakingService) { }

    @Post('quickplay')
    async quickplay(
        @Headers('authorization') auth: string,
        @Body() body: { playersCount: number; stakeVp: number },
    ) {
        const userId = getTokenUserId(auth);
        return this.mm.quickPlay(userId, body.playersCount, body.stakeVp);
    }

    @Get('match/:id/audit')
    async audit(@Param('id') id: string) {
        return this.mm.getAudit(id);
    }

    @Get('ticket/:id')
    async ticket(@Param('id') id: string) {
        return this.mm.getTicket(id);
    }

    @Post('ticket/:id/fallback')
    async fallback(@Param('id') id: string) {
        return this.mm.fallbackToBotIfTimedOut(id);
    }

    @Get('match/:id')
    async match(@Param('id') id: string) {
        return this.mm.getMatch(id);
    }

    @Post('match/:id/move')
    async move(
        @Param('id') id: string,
        @Headers('authorization') auth: string,
        @Body() body: { move: 'ROCK' | 'PAPER' | 'SCISSORS' },
    ) {
        const userId = getTokenUserId(auth);
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
        const userId = getTokenUserId(auth);
        // Создаем матч с timestamp 15 минут назад
        const result = await this.mm.createTestOrphanedMatch(userId, body.stakeVp || 100);
        return result;
    }

}
