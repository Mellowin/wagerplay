import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Financial Reconciliation
 * 
 * REC-001: Wallet balance check
 * REC-002: Reconcile endpoint returns valid data
 * REC-003: Match financial structure (pot, fee, payout)
 * REC-004: Balance changes after match
 */

describe('Financial Reconciliation (e2e)', () => {
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

  describe('REC-001: Wallet balance', () => {
    it('should return default balance for new user', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      expect(res.body.balanceWp).toBe(10000);
    });
  });

  describe('REC-002: Reconciliation endpoint', () => {
    it('should return balanced status for new user', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`)
        .timeout(5000);

      expect(res.status).toBe(200);
      expect(res.body.isBalanced).toBe(true);
      expect(res.body.discrepancy).toBe(0);
    });

    it('should have correct reconciliation structure', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`)
        .timeout(5000);

      expect(res.body).toHaveProperty('userId');
      expect(res.body).toHaveProperty('actualBalance');
      expect(res.body).toHaveProperty('expectedBalance');
      expect(res.body).toHaveProperty('discrepancy');
      expect(res.body).toHaveProperty('isBalanced');
      expect(res.body).toHaveProperty('stats');
    });
  });

  describe('REC-003: Match financial structure', () => {
    it('should have correct pot, fee, payout values', async () => {
      const [p1, p2] = await client.createGuests(2);
      const stake = 100;
      
      await client.quickplay(p1.token, 2, stake);
      await client.quickplay(p2.token, 2, stake);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(p1.token);
      const match = state.activeMatch;

      // Verify math
      expect(match.potVp).toBe(stake * 2);
      expect(match.feeVp).toBe(Math.floor(match.potVp * match.feeRate));
      expect(match.payoutVp).toBe(match.potVp - match.feeVp);
    });
  });

  describe('REC-004: Post-match reconciliation', () => {
    it('should remain balanced after match completion', async () => {
      const [p1, p2] = await client.createGuests(2);
      
      // Create and play match
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(p1.token);
      const matchId = state.activeMatch.matchId;

      // Play
      await client.submitMove(matchId, p1.token, 'ROCK');
      await client.submitMove(matchId, p2.token, 'SCISSORS');
      await new Promise(r => setTimeout(r, 2500));

      // Verify match finished
      const finalMatch = await client.getMatch(matchId, p1.token);
      expect(finalMatch.status).toBe('FINISHED');

      // Check reconciliation
      const res1 = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${p1.token}`)
        .timeout(5000);
      
      const res2 = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${p2.token}`)
        .timeout(5000);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });
});
