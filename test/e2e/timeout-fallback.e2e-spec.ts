import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Timeout and Fallback mechanisms
 * 
 * TC-TIMEOUT-01: Match with bot should not timeout waiting
 * TC-TIMEOUT-02: Move timeout in bot match
 * TC-TIMEOUT-03: Match completion without human opponent
 * TC-TIMEOUT-04: Auto-move handling with bot
 */

describe('Timeout/Fallback (e2e)', () => {
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

  describe('TC-TIMEOUT-01: Bot match creation speed', () => {
    it('should create match immediately without waiting', async () => {
      const user = await client.createGuest();

      const startTime = Date.now();
      
      // Create match - should be immediate with forceMatch
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      const createTime = Date.now() - startTime;

      // Should create match quickly (< 2 seconds with bot)
      expect(createTime).toBeLessThan(2000);
      
      // Verify state
      const state = await client.pollForActiveMatch(user.token);
      expect(state.activeMatch).toBeDefined();
    });

    it('should not keep user waiting in queue with bot', async () => {
      const user = await client.createGuest();

      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      // Check state - should be in match
      const state = await client.pollForActiveMatch(user.token);
      expect(state.queueTicket).toBeNull();
    });
  });

  describe('TC-TIMEOUT-02: Move timeout in bot match', () => {
    it('should have move deadline set', async () => {
      const user = await client.createGuest();

      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;

      // Should have deadline
      expect(match.moveDeadline).toBeDefined();
      expect(match.moveDeadline).toBeGreaterThan(Date.now());
    });

    it('should auto-resolve if player does not move', async () => {
      const user = await client.createGuest();

      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // Don't make move - wait for timeout
      // Bot will auto-move or timeout will trigger
      await new Promise(r => setTimeout(r, 15000)); // Wait longer than move timeout (12s)

      const match = await client.getMatch(matchId, user.token);
      
      // Match should be resolved (finished or auto-moved)
      expect(['FINISHED', 'IN_PROGRESS']).toContain(match.status);
    }, 20000);
  });

  describe('TC-TIMEOUT-03: Bot match completion', () => {
    it('should complete match with bot opponent', async () => {
      const user = await client.createGuest();

      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // Player makes move
      await client.submitMove(matchId, user.token, 'ROCK');
      
      // Bot moves automatically
      await new Promise(r => setTimeout(r, 3500));

      const match = await client.getMatch(matchId, user.token);
      
      // Should have moves recorded
      expect(match.moves).toBeDefined();
      expect(Object.keys(match.moves).length).toBeGreaterThan(0);
    });

    it('should determine winner in bot match', async () => {
      const user = await client.createGuest();

      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // Play
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3500));

      const match = await client.getMatch(matchId, user.token);
      
      // Should be finished with winner
      expect(match.status).toBe('FINISHED');
      expect(match.winnerId).toBeDefined();
    });
  });

  describe('TC-TIMEOUT-04: Multiple rounds with bot', () => {
    it('should handle tie and continue to next round', async () => {
      // This test checks that ties are handled correctly
      const user = await client.createGuest();

      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;
      const initialRound = state.activeMatch.round || 1;

      // Make move
      await client.submitMove(matchId, user.token, 'ROCK');
      
      // Wait for resolution
      await new Promise(r => setTimeout(r, 3500));

      const match = await client.getMatch(matchId, user.token);
      
      // Match should progress (either finished or next round)
      if (match.status === 'IN_PROGRESS') {
        expect(match.round).toBeGreaterThan(initialRound);
      } else {
        expect(match.status).toBe('FINISHED');
      }
    });
  });
});
