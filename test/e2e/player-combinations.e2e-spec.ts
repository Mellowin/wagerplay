import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Player/Bot combinations
 * 
 * Tests various combinations of real players and bots
 */

describe('Player/Bot Combinations (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;

  beforeAll(async () => {
    app = await createTestApp();
    client = new TestClient(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await flushTestDb();
  });

  describe('Single player with bots', () => {
    it('should create 2-player match with 1 real + 1 bot', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(2);
      expect(match.playerIds).toContain(user.userId);
      expect(match.playerIds.some((id: string) => id.startsWith('BOT'))).toBe(true);
      expect(match.potVp).toBe(200);
    });

    it('should create 3-player match with 1 real + 2 bots', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 100);
      await client.forceMatch(user.token, 3, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(3);
      expect(match.playerIds).toContain(user.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(2);
      expect(match.potVp).toBe(300);
    });

    it('should create 4-player match with 1 real + 3 bots', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 4, 100);
      await client.forceMatch(user.token, 4, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(4);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(3);
      expect(match.potVp).toBe(400);
    });

    it('should create 5-player match with 1 real + 4 bots', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 5, 100);
      await client.forceMatch(user.token, 5, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(5);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(4);
      expect(match.potVp).toBe(500);
    });
  });

  describe('Two real players combinations', () => {
    it('should create 2-player match with 2 real players', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      await client.quickplay(user1.token, 2, 100);
      await new Promise(r => setTimeout(r, 100));
      await client.quickplay(user2.token, 2, 100);
      await new Promise(r => setTimeout(r, 100));
      
      await client.forceMatch(user1.token, 2, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(2);
      expect(match.playerIds).toContain(user1.userId);
      expect(match.playerIds).toContain(user2.userId);
    });

    it('should create 3-player match with 2 real + 1 bot', async () => {
      const [user1, user2] = await client.createGuests(2);
      
      await client.quickplay(user1.token, 3, 100);
      await new Promise(r => setTimeout(r, 100));
      await client.quickplay(user2.token, 3, 100);
      await new Promise(r => setTimeout(r, 100));
      
      await client.forceMatch(user1.token, 3, 100);
      
      const state1 = await client.pollForActiveMatch(user1.token);
      const match = state1.activeMatch;
      
      expect(match).toBeDefined();
      expect(match.playerIds).toHaveLength(3);
      expect(match.playerIds).toContain(user1.userId);
      expect(match.playerIds).toContain(user2.userId);
      
      const botCount = match.playerIds.filter((id: string) => id.startsWith('BOT')).length;
      expect(botCount).toBe(1);
    });
  });

  describe('Gameplay with different player counts', () => {
    it('should complete 2-player match (1 real + 1 bot)', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
      expect(finalMatch.winnerId).toBeDefined();
    });

    it('should complete 3-player match (1 real + 2 bots)', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 100);
      await client.forceMatch(user.token, 3, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
    });

    it('should complete 5-player match (1 real + 4 bots)', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 5, 100);
      await client.forceMatch(user.token, 5, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
    });
  });

  describe('Financial verification', () => {
    it('should freeze correct stake for 2-player match', async () => {
      const user = await client.createGuest();
      
      const initialWallet = await client.getWallet(user.token);
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await client.pollForActiveMatch(user.token);
      
      const duringWallet = await client.getWallet(user.token);
      
      expect(duringWallet.balanceWp).toBe(initialWallet.balanceWp - 100);
    });

    it('should freeze correct stake for 5-player match', async () => {
      const user = await client.createGuest();
      
      const initialWallet = await client.getWallet(user.token);
      
      await client.quickplay(user.token, 5, 200);
      await client.forceMatch(user.token, 5, 200);
      await client.pollForActiveMatch(user.token);
      
      const duringWallet = await client.getWallet(user.token);
      
      expect(duringWallet.balanceWp).toBe(initialWallet.balanceWp - 200);
    });
  });

  describe('Bot nicknames', () => {
    it('should assign bot nicknames in match', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 3, 100);
      await client.forceMatch(user.token, 3, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;
      
      expect(match.botNames).toBeDefined();
      
      const botIds = match.playerIds.filter((id: string) => id.startsWith('BOT'));
      for (const botId of botIds) {
        expect(match.botNames[botId]).toBeDefined();
        expect(match.botNames[botId].length).toBeGreaterThan(0);
      }
    });
  });
});
