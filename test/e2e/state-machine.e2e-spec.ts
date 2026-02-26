import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for State Machine validation
 * 
 * TC-STATE-02: Move in FINISHED match -> 400
 * TC-STATE-04: Duplicate move in same round -> 400
 */

describe('State Machine (e2e)', () => {
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

  describe('TC-STATE-04: Duplicate move prevention', () => {
    it('should reject duplicate move in same round', async () => {
      // Create two users and match
      const [userA, userB] = await client.createGuests(2);
      
      await client.quickplay(userA.token, 2, 100);
      await client.quickplay(userB.token, 2, 100);
      
      await new Promise(r => setTimeout(r, 1500));

      // Get match
      const state = await client.getActiveState(userA.token);
      const matchId = state.activeMatch.matchId;

      // First move - accepted
      const firstMove = await client.submitMove(matchId, userA.token, 'ROCK');
      expect(firstMove.status).toBe(201);

      // Duplicate move - rejected
      const secondMove = await client.submitMove(matchId, userA.token, 'PAPER');
      expect(secondMove.status).toBe(400);
      expect(secondMove.body.message).toMatch(/already made your move/i);
    });
  });

  describe('TC-STATE-02: Move in finished match', () => {
    it('should reject move in FINISHED match', async () => {
      // Create match
      const [userA, userB] = await client.createGuests(2);
      
      await client.quickplay(userA.token, 2, 100);
      await client.quickplay(userB.token, 2, 100);
      
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(userA.token);
      const matchId = state.activeMatch.matchId;

      // Both players move - match finishes (ROCK beats SCISSORS)
      await client.submitMove(matchId, userA.token, 'ROCK');
      await client.submitMove(matchId, userB.token, 'SCISSORS');
      
      await new Promise(r => setTimeout(r, 2000));

      // Verify match is finished
      const match = await client.getMatch(matchId, userA.token);
      expect(match.status).toBe('FINISHED');

      // Try to move in finished match
      const response = await client.submitMove(matchId, userA.token, 'PAPER');
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/already finished|finished/i);
    });
  });
});
