import { Controller, Get, Headers } from '@nestjs/common';
import { WalletsService } from './wallets.service';

function getTokenUserId(authHeader?: string): string {
    if (!authHeader) return '';
    const s = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    return s.trim();
}

@Controller('wallet')
export class WalletsController {
    constructor(private wallets: WalletsService) { }

    @Get()
    async me(@Headers('authorization') auth?: string) {
        const userId = getTokenUserId(auth);
        const w = await this.wallets.getByUserId(userId);
        if (!w) return { userId, balanceWp: 0, frozenWp: 0 };
        return { userId, balanceWp: w.balanceWp, frozenWp: w.frozenWp };
    }
}
