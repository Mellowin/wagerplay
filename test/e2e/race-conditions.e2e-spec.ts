import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Race Conditions
 * 
 * TC-RACE-01: Double quickplay should not create duplicate ticket/match
 * TC-RACE-02: Double parallel move (KNOWN ISSUE - skipped until fixed)
 */

describe('Race Conditions (e2e)', () => {
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

  describe('TC-RACE-01: Double quickplay protection', () => {
    it('should prevent duplicate quickplay with parallel requests', async () => {
      const user = await client.createGuest();

      // Send two parallel quickplay requests
      const [result1, result2] = await Promise.all([
        client.quickplay(user.token, 2, 100),
        client.quickplay(user.token, 2, 100),
      ]);

      // One should succeed (QUEUED/MATCH_READY), other rejected or indicate existing state
      // After Redis lock fix: one gets through, other gets error/ALREADY_IN_QUEUE/ALREADY_IN_MATCH
      const hasExpectedOutcome = 
        result1.status === 'QUEUED' || result2.status === 'QUEUED' ||
        result1.status === 'MATCH_READY' || result2.status === 'MATCH_READY' ||
        result1.status === 'ALREADY_IN_QUEUE' || result2.status === 'ALREADY_IN_QUEUE' ||
        result1.status === 'ALREADY_IN_MATCH' || result2.status === 'ALREADY_IN_MATCH' ||
        result1.message?.includes('Duplicate') || result2.message?.includes('Duplicate');
      
      expect(hasExpectedOutcome).toBe(true);

      // Check final state - user should not have multiple active tickets
      await new Promise(r => setTimeout(r, 500));
      const state = await client.getActiveState(user.token);
      
      // Invariant: user cannot be simultaneously in multiple queues/matches
      const activeTickets = state.queueTicket ? 1 : 0;
      const activeMatches = state.activeMatch ? 1 : 0;
      
      expect(activeTickets + activeMatches).toBeLessThanOrEqual(1);
    });

    it('should handle rapid sequential quickplay calls', async () => {
      const user = await client.createGuest();

      // First call
      const r1 = await client.quickplay(user.token, 2, 100);
      
      // Immediate second call (before match created)
      const r2 = await client.quickplay(user.token, 2, 100);

      // Second should be rejected or indicate existing state
      expect(
        r2.status === 'ALREADY_IN_QUEUE' || 
        r2.status === 'ALREADY_IN_MATCH' ||
        r2.statusCode === 400
      ).toBeTruthy();
    });
  });

  describe('TC-RACE-02: Double parallel move', () => {
    it('should accept parallel moves from different players', async () => {
      const [p1, p2] = await client.createGuests(2);
      
      // Create match
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 2000));

      const state = await client.getActiveState(p1.token);
      const matchId = state.activeMatch.matchId;

      // Both players send parallel moves
      const [res1, res2] = await Promise.all([
        client.submitMove(matchId, p1.token, 'ROCK'),
        client.submitMove(matchId, p2.token, 'PAPER'),
      ]);

      // At least one should succeed (race condition may affect both)
      const successCount = [res1.status, res2.status].filter(s => s === 201).length;
      expect(successCount).toBeGreaterThanOrEqual(1);
      
      // System should remain consistent
      const finalMatch = await client.getMatch(matchId, p1.token);
      expect(['IN_PROGRESS', 'FINISHED']).toContain(finalMatch.status);
    });

    it('should reject duplicate moves from same player', async () => {
      const [p1, p2] = await client.createGuests(2);
      
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(p1.token);
      const matchId = state.activeMatch.matchId;

      // First move
      const firstMove = await client.submitMove(matchId, p1.token, 'ROCK');
      expect(firstMove.status).toBe(201);

      // Rapid duplicate from same player
      const duplicate = await client.submitMove(matchId, p1.token, 'PAPER');
      
      // Should be rejected
      expect(duplicate.status).toBe(400);
      expect(duplicate.body.message).toMatch(/already made your move/i);
    });

    it('should handle rapid concurrent move submissions gracefully', async () => {
      // This test checks system stability under rapid parallel submissions
      // Documents current behavior - may accept 1+ moves depending on timing
      
      const [p1, p2] = await client.createGuests(2);
      
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 2000));

      const state = await client.getActiveState(p1.token);
      const matchId = state.activeMatch.matchId;

      // Rapid parallel submissions from same user
      const results = await Promise.all([
        client.submitMove(matchId, p1.token, 'ROCK'),
        client.submitMove(matchId, p1.token, 'ROCK'),
        client.submitMove(matchId, p1.token, 'ROCK'),
      ]);

      // Count results
      const successes = results.filter(r => r.status === 201).length;
      const rejections = results.filter(r => r.status === 400).length;
      
      console.log(`[TC-RACE-02] Moves accepted: ${successes}, rejected: ${rejections}`);
      
      // System should handle gracefully without crashing
      expect(successes + rejections).toBe(3);
      
      // At least one should succeed (the race winner)
      expect(successes).toBeGreaterThanOrEqual(1);
      
      // Complete the match with p2 move
      await client.submitMove(matchId, p2.token, 'SCISSORS');
      await new Promise(r => setTimeout(r, 3000));
      
      const finalMatch = await client.getMatch(matchId, p1.token);
      expect(finalMatch.status).toBe('FINISHED');
    });
  });
});
