import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';

function getTokenUserId(authHeader?: string): string {
    // MVP: токен = userId (как у нас сейчас после guest)
    if (!authHeader) return '';
    const s = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    return s.trim();
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

}
