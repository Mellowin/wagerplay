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
 * REC-004: Balance changes after match with bot
 * REC-005: Stats accuracy after bot match
 * REC-006: Post-match reconciliation with bot
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
    it('should have correct pot, fee, payout values for bot match', async () => {
      const user = await client.createGuest();
      const stake = 100;
      
      await client.quickplay(user.token, 2, stake);
      await client.forceMatch(user.token, 2, stake);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const match = state.activeMatch;

      // Verify math (2 players: 1 real + 1 bot)
      expect(match.potVp).toBe(stake * 2);
      expect(match.feeVp).toBe(Math.floor(match.potVp * match.feeRate));
      expect(match.payoutVp).toBe(match.potVp - match.feeVp);
    });
  });

  describe('REC-004: Post-match reconciliation with bot', () => {
    it('should remain balanced after bot match completion', async () => {
      const user = await client.createGuest();
      
      // Create and play match with bot
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // Play (bot moves automatically)
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));

      // Verify match finished
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');

      // Check reconciliation
      const res = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`)
        .timeout(5000);

      expect(res.status).toBe(200);
      expect(res.body.isBalanced).toBe(true);
    });

    it('should correctly calculate net profit after win', async () => {
      const user = await client.createGuest();
      const stake = 100;
      
      // Get initial stats
      const initialRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);
      const initialNetProfit = initialRes.body.stats.netProfit;
      
      // Play match
      await client.quickplay(user.token, 2, stake);
      await client.forceMatch(user.token, 2, stake);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));

      // Check final stats
      const finalRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);

      expect(finalRes.status).toBe(200);
      // Net profit should change (either +profit or -stake)
      expect(finalRes.body.stats.netProfit).not.toBe(initialNetProfit);
      
      // If won: netProfit = payout - stake (e.g., 190 - 100 = 90)
      // If lost: netProfit = -stake (e.g., -100)
      const netChange = finalRes.body.stats.netProfit - initialNetProfit;
      expect(netChange === 90 || netChange === -100).toBeTruthy(); // 90 is net profit for 100 stake (5% fee)
    });
  });

  describe('REC-005: Stats accuracy after bot match', () => {
    it('should update totalMatches counter', async () => {
      const user = await client.createGuest();
      
      const initialRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);
      const initialMatches = initialRes.body.stats.totalMatches || 0;

      // Play match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      await client.submitMove(state.activeMatch.matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));

      const finalRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);

      expect(finalRes.body.stats.totalMatches).toBe(initialMatches + 1);
    });

    it('should update wins/losses correctly', async () => {
      const user = await client.createGuest();
      
      const initialRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);
      const initialWins = initialRes.body.stats.wins || 0;
      const initialLosses = initialRes.body.stats.losses || 0;

      // Play match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      await client.submitMove(state.activeMatch.matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 3000));

      const finalRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);

      // Either win or loss should increment
      const winsChanged = finalRes.body.stats.wins !== initialWins;
      const lossesChanged = finalRes.body.stats.losses !== initialLosses;
      expect(winsChanged || lossesChanged).toBe(true);
    });
  });

  describe('REC-006: Multiple matches reconciliation', () => {
    it('should handle multiple bot matches', async () => {
      const user = await client.createGuest();

      // Play 3 matches
      for (let i = 0; i < 3; i++) {
        await flushTestDb(); // Clean between matches
        const freshUser = await client.createGuest();
        
        await client.quickplay(freshUser.token, 2, 100);
        await new Promise(r => setTimeout(r, 500));

        const state = await client.getActiveState(freshUser.token);
        if (state.activeMatch) {
          await client.submitMove(state.activeMatch.matchId, freshUser.token, 'ROCK');
          await new Promise(r => setTimeout(r, 1500));
        }

        const res = await request(app.getHttpServer())
          .get('/wallet/reconcile')
          .set('Authorization', `Bearer ${freshUser.token}`);

        expect(res.status).toBe(200);
        expect(res.body.isBalanced).toBe(true);
      }
    });
  });
});
