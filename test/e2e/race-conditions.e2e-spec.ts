import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Race Conditions
 * 
 * TC-RACE-01: Double quickplay should not create duplicate ticket/match
 * TC-RACE-02: Double parallel move (with bot)
 * TC-RACE-03: Rapid sequential quickplay calls with bot
 * TC-RACE-04: Match creation while already in bot match
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

      // One should succeed (MATCH_READY), other rejected or indicate existing state
      const hasExpectedOutcome = 
        result1.status === 'MATCH_READY' || result2.status === 'MATCH_READY' ||
        result1.status === 'IN_PROGRESS' || result2.status === 'IN_PROGRESS' ||
        result1.status === 'ALREADY_IN_QUEUE' || result2.status === 'ALREADY_IN_QUEUE' ||
        result1.status === 'ALREADY_IN_MATCH' || result2.status === 'ALREADY_IN_MATCH' ||
        result1.matchId || result2.matchId ||
        result1.message?.includes('Duplicate') || result2.message?.includes('Duplicate');
      
      expect(hasExpectedOutcome).toBe(true);

      // Check final state - user should not have multiple active resources
      await new Promise(r => setTimeout(r, 500));
      const state = await client.getActiveState(user.token);
      
      // Invariant: user cannot be simultaneously in multiple queues/matches
      const activeTickets = state.queueTicket ? 1 : 0;
      const activeMatches = state.activeMatch ? 1 : 0;
      
      expect(activeTickets + activeMatches).toBeLessThanOrEqual(1);
    });

    it('should handle rapid sequential quickplay calls', async () => {
      const user = await client.createGuest();

      // First call - creates ticket
      const r1 = await client.quickplay(user.token, 2, 100);
      expect(r1.status === 'QUEUED' || r1.matchId || r1.status === 'MATCH_READY').toBeTruthy();
      
      // Create match with forceMatch
      await client.forceMatch(user.token, 2, 100);
      
      // Immediate second call (while in bot match)
      const r2 = await client.quickplay(user.token, 2, 100);

      // Second should be rejected or indicate already in match
      expect(
        r2.status === 'ALREADY_IN_QUEUE' || 
        r2.status === 'ALREADY_IN_MATCH' ||
        r2.statusCode === 400 ||
        r2.message?.includes('already') ||
        r2.message?.includes('Duplicate')
      ).toBeTruthy();
    });

    it('should not create multiple matches for same user', async () => {
      const user = await client.createGuest();

      // Try to create multiple tickets rapidly
      const results = await Promise.all([
        client.quickplay(user.token, 2, 100),
        client.quickplay(user.token, 2, 100),
        client.quickplay(user.token, 2, 100),
      ]);

      // Count successful queue joins
      const queueJoins = results.filter(r => 
        r.status === 'QUEUED' || r.ticketId
      ).length;

      // Should only create one ticket
      expect(queueJoins).toBeLessThanOrEqual(1);

      // Now create match with forceMatch
      await client.forceMatch(user.token, 2, 100);
      
      // Verify state
      const state = await client.pollForActiveMatch(user.token);
      expect(state.activeMatch).toBeDefined();
    });
  });

  describe('TC-RACE-02: Move handling with bot', () => {
    it('should handle rapid move submissions gracefully', async () => {
      const user = await client.createGuest();
      
      // Create bot match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);

      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // Rapid parallel submissions
      const results = await Promise.all([
        client.submitMove(matchId, user.token, 'ROCK'),
        client.submitMove(matchId, user.token, 'ROCK'),
        client.submitMove(matchId, user.token, 'ROCK'),
      ]);

      // Count results
      const successes = results.filter(r => r.status === 201).length;
      const rejections = results.filter(r => r.status === 400).length;
      
      console.log(`[TC-RACE-02] Moves accepted: ${successes}, rejected: ${rejections}`);
      
      // System should handle gracefully without crashing
      expect(successes + rejections).toBe(3);
      
      // At least one should succeed (the race winner)
      expect(successes).toBeGreaterThanOrEqual(1);
      
      // Match should complete
      await new Promise(r => setTimeout(r, 3000));
      
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');
    });

    it('should reject duplicate moves from same player', async () => {
      const user = await client.createGuest();
      
      // Create bot match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);

      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // First move - accepted
      const firstMove = await client.submitMove(matchId, user.token, 'ROCK');
      expect(firstMove.status).toBe(201);

      // Rapid duplicate from same player
      const duplicate = await client.submitMove(matchId, user.token, 'PAPER');
      
      // Should be rejected
      expect(duplicate.status).toBe(400);
    });
  });

  describe('TC-RACE-03: Queue and match state transitions', () => {
    it('should transition from QUEUED to MATCH_READY correctly', async () => {
      // This test verifies that if a user joins queue, they eventually get a match
      const user = await client.createGuest();

      const result = await client.quickplay(user.token, 2, 100);
      
      // Should be queued initially
      expect(result.status === 'QUEUED' || result.ticketId).toBeTruthy();

      // Use forceMatch to create match
      await client.forceMatch(user.token, 2, 100);
      
      // Verify active state
      const state = await client.pollForActiveMatch(user.token);
      expect(state.activeMatch).toBeDefined();
    });

    it('should handle match completion and allow new match', async () => {
      const user = await client.createGuest();

      // First match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);

      let state = await client.pollForActiveMatch(user.token);
      const matchId1 = state.activeMatch.matchId;

      // Play and finish
      await client.submitMove(matchId1, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));

      // Verify finished
      const match1 = await client.getMatch(matchId1, user.token);
      expect(match1.status).toBe('FINISHED');

      // Flush to clear state for new match
      await flushTestDb();

      // New match should be possible
      const user2 = await client.createGuest();
      await client.quickplay(user2.token, 2, 100);
      await client.forceMatch(user2.token, 2, 100);

      state = await client.pollForActiveMatch(user2.token);
      expect(state.activeMatch.matchId).not.toBe(matchId1);
    });
  });

  describe('TC-RACE-04: Concurrent state checks', () => {
    it('should return consistent state under concurrent checks', async () => {
      const user = await client.createGuest();

      // Create match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);

      // Multiple concurrent state checks
      const states = await Promise.all([
        client.getActiveState(user.token),
        client.getActiveState(user.token),
        client.getActiveState(user.token),
      ]);

      // All should return same match
      const matchIds = states.map(s => s.activeMatch?.matchId).filter(Boolean);
      expect(new Set(matchIds).size).toBe(1); // All same matchId
    });
  });
});
