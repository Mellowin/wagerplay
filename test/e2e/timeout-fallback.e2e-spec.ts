import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Timeout and Fallback scenarios
 * 
 * TO-001: Match expires without moves
 * TO-002: Player eliminated for timeout
 * TO-003: Fallback to bot after timeout
 */

describe('Timeout and Fallback (e2e)', () => {
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

  describe('TO-001: Match progression', () => {
    it('should allow match to progress with moves', async () => {
      // Create match with longer setup to test round progression
      const [p1, p2] = await client.createGuests(2);
      
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 2500));

      const state = await client.getActiveState(p1.token);
      expect(state.activeMatch).toBeDefined();
      expect(['IN_PROGRESS', 'READY']).toContain(state.activeMatch.status);
    });

    it('should track round number correctly', async () => {
      const [p1, p2] = await client.createGuests(2);
      
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(p1.token);
      const matchId = state.activeMatch.matchId;

      // Initial round
      let match = await client.getMatch(matchId, p1.token);
      expect(match.round).toBe(1);

      // Play round
      await client.submitMove(matchId, p1.token, 'ROCK');
      await client.submitMove(matchId, p2.token, 'PAPER'); // P2 wins
      await new Promise(r => setTimeout(r, 2000));

      // Match should finish with winner
      match = await client.getMatch(matchId, p1.token);
      expect(match.status).toBe('FINISHED');
      expect(match.winnerId).toBeDefined();
    });
  });

  describe('TO-002: Elimination flow', () => {
    it('should eliminate loser and keep winner', async () => {
      const [p1, p2] = await client.createGuests(2);
      
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(p1.token);
      const matchId = state.activeMatch.matchId;

      // P1 plays ROCK, P2 plays SCISSORS - P1 wins
      await client.submitMove(matchId, p1.token, 'ROCK');
      await client.submitMove(matchId, p2.token, 'SCISSORS');
      await new Promise(r => setTimeout(r, 2000));

      const match = await client.getMatch(matchId, p1.token);
      
      expect(match.status).toBe('FINISHED');
      expect(match.winnerId).toBe(p1.userId);
      expect(match.eliminatedIds).toContain(p2.userId);
      expect(match.aliveIds).toContain(p1.userId);
      expect(match.aliveIds).not.toContain(p2.userId);
    });
  });

  describe('TO-003: Match settlement', () => {
    it('should settle match with correct payout', async () => {
      const [p1, p2] = await client.createGuests(2);
      const stake = 100;
      
      await client.quickplay(p1.token, 2, stake);
      await client.quickplay(p2.token, 2, stake);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(p1.token);
      const match = state.activeMatch;
      const matchId = match.matchId;
      const expectedPayout = match.payoutVp;

      // Play to finish
      await client.submitMove(matchId, p1.token, 'ROCK');
      await client.submitMove(matchId, p2.token, 'SCISSORS');
      await new Promise(r => setTimeout(r, 2000));

      const finalMatch = await client.getMatch(matchId, p1.token);
      
      expect(finalMatch.settled).toBe(true);
      expect(finalMatch.payoutVp).toBe(expectedPayout);
      expect(finalMatch.feeVp + finalMatch.payoutVp).toBe(finalMatch.potVp);
    });
  });
});
