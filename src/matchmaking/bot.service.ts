import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Match, Move } from './types';

// 🎮 Реалистичные ники для ботов
const BOT_NICKNAMES = [
    'Alex_Pro', 'LuckyShot', 'MasterRock', 'ScissorsKing', 'PaperTigress',
    'RockStar', 'NinjaMove', 'PhantomHand', 'BlitzPlay', 'StormGamer',
    'CyberFist', 'IronGrip', 'SwiftCut', 'SilentWin', 'DarkHorse',
    'FlashBang', 'NoMercy', 'RisingSun', 'IceBreaker', 'FireStorm',
    'ShadowHunter', 'ThunderBolt', 'QuickDraw', 'SteelFist', 'ViperStrike',
    'GhostRider', 'BladeRunner', 'MegaMind', 'SuperNova', 'ThunderBird',
    'CrystalEye', 'DiamondHand', 'GoldenTouch', 'SilverBullet', 'BronzeBeast',
    'NightWolf', 'DayWalker', 'StarLord', 'MoonLight', 'SunTzu',
    'TigerClaw', 'DragonFist', 'EagleEye', 'SharkBite', 'WolfPack',
    'CobraKai', 'Panthera', 'Grizzly', 'FalconPunch', 'PhoenixRise'
];

@Injectable()
export class BotService {
    
    /**
     * Проверяет является ли ID ботом
     */
    isBot(id: string): boolean {
        return id.startsWith('BOT');
    }

    /**
     * Генерирует случайные имена для ботов
     */
    getRandomBotNames(count: number): string[] {
        const shuffled = [...BOT_NICKNAMES].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    /**
     * Фильтрует только реальных игроков (не ботов)
     */
    filterRealPlayers(playerIds: string[]): string[] {
        return playerIds.filter(id => !this.isBot(id));
    }

    /**
     * Проверяет остались ли только боты
     */
    onlyBotsLeft(aliveIds: string[]): boolean {
        return aliveIds.every(id => this.isBot(id));
    }

    /**
     * Проверяет есть ли боты в матче
     */
    hasBots(playerIds: string[]): boolean {
        return playerIds.some(id => this.isBot(id));
    }

    /**
     * Генерирует случайный ход для бота
     */
    generateBotMove(): Move {
        const moves: Move[] = ['ROCK', 'PAPER', 'SCISSORS'];
        return moves[randomInt(0, 3)];
    }

    /**
     * Создаёт ходы для всех ботов в матче
     */
    generateBotMoves(match: Match): Record<string, Move> {
        const botMoves: Record<string, Move> = {};
        
        for (const playerId of match.aliveIds) {
            if (this.isBot(playerId) && !match.moves[playerId]) {
                botMoves[playerId] = this.generateBotMove();
            }
        }
        
        return botMoves;
    }
}
