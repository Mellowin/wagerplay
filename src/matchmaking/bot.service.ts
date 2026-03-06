import { Injectable } from '@nestjs/common';

const BOT_NAMES = [
    'ShadowHunter', 'NightStalker', 'CyberWolf', 'PhantomX', 'IronClaw',
    'NeoStrike', 'DarkViper', 'ThunderBot', 'GhostRider', 'SteelFang',
    'VenomStrike', 'BlazeRunner', 'FrostByte', 'NovaBlast', 'EchoZero',
    'RogueAI', 'MechaLord', 'VoidWalker', 'StarCrusher', 'NinjaBot',
];

/**
 * Сервис для работы с ботами
 * Генерация имён, ходов, проверка типа игрока
 */
@Injectable()
export class BotService {
    /**
     * Проверяет является ли ID ботом
     */
    isBot(id: string): boolean {
        return id?.startsWith('BOT') ?? false;
    }

    /**
     * Генерирует случайные имена для ботов
     */
    getRandomBotNames(count: number): string[] {
        const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    /**
     * Генерирует случайный ход для бота
     */
    generateBotMove(): 'ROCK' | 'PAPER' | 'SCISSORS' {
        const moves: ('ROCK' | 'PAPER' | 'SCISSORS')[] = ['ROCK', 'PAPER', 'SCISSORS'];
        return moves[Math.floor(Math.random() * moves.length)];
    }

    /**
     * Проверяет есть ли в массиве хотя бы один бот
     */
    hasBots(playerIds: string[]): boolean {
        return playerIds.some(id => this.isBot(id));
    }

    /**
     * Фильтрует только реальных игроков (не ботов)
     */
    getRealPlayers(playerIds: string[]): string[] {
        return playerIds.filter(id => !this.isBot(id));
    }

    /**
     * Проверяет все ли игроки - боты
     */
    allBots(playerIds: string[]): boolean {
        return playerIds.length > 0 && playerIds.every(id => this.isBot(id));
    }
}
