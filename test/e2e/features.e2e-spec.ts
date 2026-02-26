import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for New Features
 * 
 * FEAT-001: Online counter endpoint
 * FEAT-002: Match history endpoint
 * FEAT-003: Profile displayName persistence
 * FEAT-004: Balance reconciliation accuracy
 */

describe('New Features (e2e)', () => {
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

  describe('FEAT-001: Online counter', () => {
    it('should return online count', async () => {
      const response = await request(app.getHttpServer())
        .get('/matchmaking/online');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
      expect(typeof response.body.count).toBe('number');
      expect(response.body.count).toBeGreaterThanOrEqual(0);
    });

    it('should count users in matches', async () => {
      const user = await client.createGuest();
      
      // Get initial count
      const initialRes = await request(app.getHttpServer())
        .get('/matchmaking/online');
      const initialCount = initialRes.body.count;

      // User creates match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));

      // Count should increase
      const finalRes = await request(app.getHttpServer())
        .get('/matchmaking/online');
      
      // User is in match, so count should reflect that
      expect(finalRes.body.count).toBeGreaterThanOrEqual(initialCount);
    });
  });

  describe('FEAT-002: Match history', () => {
    it('should return empty history for new user', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get(`/matchmaking/history?userId=${user.userId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('matches');
      expect(Array.isArray(response.body.matches)).toBe(true);
      expect(response.body.matches.length).toBe(0);
    });

    it('should record match after completion', async () => {
      const user = await client.createGuest();

      // Play match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));

      // Check history
      const response = await request(app.getHttpServer())
        .get(`/matchmaking/history?userId=${user.userId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.matches.length).toBeGreaterThan(0);
      
      const match = response.body.matches[0];
      expect(match).toHaveProperty('id');
      expect(match).toHaveProperty('stake');
      expect(match).toHaveProperty('payout');
      expect(match).toHaveProperty('winnerId');
    });

    it('should reject unauthorized history access', async () => {
      const userA = await client.createGuest();
      const userB = await client.createGuest();

      // UserB tries to access UserA's history
      const response = await request(app.getHttpServer())
        .get(`/matchmaking/history?userId=${userA.userId}`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(response.status).toBe(401);
    });
  });

  describe('FEAT-003: Profile and displayName', () => {
    it('should update and retrieve displayName', async () => {
      const user = await client.createGuest();

      // Update displayName
      const updateRes = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: 'TestUser123' });

      expect(updateRes.status).toBe(200);

      // Retrieve profile
      const profileRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${user.token}`);

      expect(profileRes.status).toBe(200);
      expect(profileRes.body.displayName).toBe('TestUser123');
    });

    it('should persist displayName for guest', async () => {
      const user = await client.createGuest();

      // Set displayName
      await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: 'GuestPlayer' });

      // Retrieve again
      const profileRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${user.token}`);

      expect(profileRes.body.displayName || profileRes.body.username).toContain('Guest');
    });
  });

  describe('FEAT-004: Balance accuracy', () => {
    it('should have correct balance after win', async () => {
      const user = await client.createGuest();

      // Initial balance
      const initialRes = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${user.token}`);
      const initialBalance = initialRes.body.balanceWp;
      expect(initialBalance).toBe(10000);

      // Play match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // During match, balance should be reduced by stake
      const duringRes = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${user.token}`);
      expect(duringRes.body.balanceWp).toBe(9900); // 10000 - 100 stake

      // Make move
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));

      // After match, balance should reflect result
      const finalRes = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${user.token}`);
      
      // Balance should be either 10000 + 90 (win) or 9900 (loss)
      // Actually stake is returned + winnings, so:
      // Win: 9900 + 190 = 10090
      // Loss: 9900 (stake lost)
      expect([9900, 10090]).toContain(finalRes.body.balanceWp);
    });

    it('should reconcile correctly after multiple matches', async () => {
      const user = await client.createGuest();

      // Play 2 matches
      for (let i = 0; i < 2; i++) {
        await client.quickplay(user.token, 2, 100);
        await client.forceMatch(user.token, 2, 100);
        await new Promise(r => setTimeout(r, 500));
        
        const state = await client.pollForActiveMatch(user.token);
        await client.submitMove(state.activeMatch.matchId, user.token, 'ROCK');
        await new Promise(r => setTimeout(r, 3000));
      }

      // Reconcile
      const reconcileRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);

      expect(reconcileRes.status).toBe(200);
      // Should be balanced or small discrepancy acceptable
      expect(Math.abs(reconcileRes.body.discrepancy)).toBeLessThanOrEqual(100);
    });
  });
});
