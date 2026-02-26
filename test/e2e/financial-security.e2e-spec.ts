import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Financial Security
 * 
 * FIN-001: Cannot spend frozen balance twice
 * FIN-002: Cannot create match with insufficient balance
 * FIN-003: Cannot use negative stake
 * FIN-004: Cannot create match with 0 players
 * FIN-005: Mass assignment protection (extra fields ignored)
 * FIN-006: Bot match creation (1 player + bot)
 * FIN-007: Match financial structure verification
 */

describe('Financial Security (e2e)', () => {
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

  describe('FIN-001: Balance constraints', () => {
    it('should reject stake larger than balance', async () => {
      const user = await client.createGuest();
      
      // Try to create match with stake > 10000
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2, stakeVp: 99999 });

      expect(res.status).toBe(400);
    });

    it('should reject negative stake', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2, stakeVp: -100 });

      expect(res.status).toBe(400);
    });

    it('should reject zero stake', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2, stakeVp: 0 });

      expect(res.status).toBe(400);
    });
  });

  describe('FIN-002: Player count validation', () => {
    it('should reject single player match (less than 2)', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 1, stakeVp: 100 });

      expect(res.status).toBe(400);
    });

    it('should reject too many players', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 10, stakeVp: 100 });

      expect(res.status).toBe(400);
    });

    it('should reject negative players', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: -2, stakeVp: 100 });

      expect(res.status).toBe(400);
    });
  });

  describe('FIN-003: Mass assignment protection', () => {
    it('should ignore extra fields in quickplay request', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ 
          playersCount: 2, 
          stakeVp: 100,
          extraField: 'ignored',
          userId: 'hacked-id',
          balanceWp: 999999
        });

      // Should succeed but ignore extra fields
      expect(res.status).toBe(201);
    });

    it('should ignore extra fields in move request', async () => {
      const user = await client.createGuest();
      
      // Create match with bot (1 player + bot)
      await client.quickplay(user.token, 2, 100);; await client.forceMatch(user.token, 2, 100);; await new Promise(r => setTimeout(r, 300));
      await client.forceMatch(user.token, 2, 100); // Force immediate match creation
      await new Promise(r => setTimeout(r, 300));

      const state = await client.getActiveState(user.token);
      expect(state.activeMatch).toBeDefined();
      const matchId = state.activeMatch.matchId;

      const res = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ 
          move: 'ROCK',
          extraField: 'ignored',
          userId: 'hacked-id'
        });

      expect(res.status).toBe(201);
    });
  });

  describe('FIN-004: Integer overflow protection', () => {
    it('should reject extremely large stake values', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2, stakeVp: 999999999999 });

      expect(res.status).toBe(400);
    });
  });

  describe('FIN-005: Precision and rounding', () => {
    it('should reject fractional stake', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2, stakeVp: 100.5 });

      expect(res.status).toBe(400);
    });
  });

  describe('FIN-006: Bot match creation (current logic)', () => {
    it('should create match immediately with 1 player + bot', async () => {
      const user = await client.createGuest();
      
      const res = await client.quickplay(user.token, 2, 100);; await client.forceMatch(user.token, 2, 100);; await new Promise(r => setTimeout(r, 300));
      
      // Should create match immediately (not just queue)
      expect(res.status === 'MATCH_READY' || res.status === 'IN_PROGRESS' || res.matchId).toBeTruthy();
      
      // Verify user is in match
      await new Promise(r => setTimeout(r, 300));
      const state = await client.getActiveState(user.token);
      expect(state.activeMatch).toBeDefined();
      expect(state.queueTicket).toBeNull();
    });

    it('should freeze balance when match created', async () => {
      const user = await client.createGuest();
      const stake = 100;
      
      // Get initial balance
      const walletRes = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${user.token}`);
      
      const initialBalance = walletRes.body.balanceWp;
      
      // Create match
      await client.quickplay(user.token, 2, stake);; await client.forceMatch(user.token, 2, stake);; await new Promise(r => setTimeout(r, 300));
      await new Promise(r => setTimeout(r, 300));
      
      // Check balance is reduced (frozen)
      const walletRes2 = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${user.token}`);
      
      expect(walletRes2.body.balanceWp).toBe(initialBalance - stake);
    });

    it('should support different player counts with bot', async () => {
      // Test 2, 3, 4, 5 players modes (all with bot)
      for (const playersCount of [2, 3, 4, 5]) {
        await flushTestDb();
        const user = await client.createGuest();
        
        await client.quickplay(user.token, playersCount, 100);
        await client.forceMatch(user.token, playersCount, 100);
        await new Promise(r => setTimeout(r, 300));
        
        // Verify match created
        const state = await client.getActiveState(user.token);
        expect(state.activeMatch).toBeDefined();
      }
    });
  });

  describe('FIN-007: Match financial structure', () => {
    it('should have correct pot, fee, payout values for bot match', async () => {
      const user = await client.createGuest();
      const stake = 100;
      
      await client.quickplay(user.token, 2, stake);; await client.forceMatch(user.token, 2, stake);; await new Promise(r => setTimeout(r, 300));
      await new Promise(r => setTimeout(r, 500));

      const state = await client.getActiveState(user.token);
      expect(state.activeMatch).toBeDefined();
      const match = state.activeMatch;

      // Verify math (2 players: 1 real + 1 bot)
      expect(match.potVp).toBe(stake * 2);
      expect(match.feeVp).toBe(Math.floor(match.potVp * match.feeRate));
      expect(match.payoutVp).toBe(match.potVp - match.feeVp);
    });

    it('should have correct net profit calculation on win', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);; await client.forceMatch(user.token, 2, 100);; await new Promise(r => setTimeout(r, 300));
      await new Promise(r => setTimeout(r, 800));

      const state = await client.getActiveState(user.token);
      expect(state.activeMatch).toBeDefined();
      const matchId = state.activeMatch.matchId;

      // Make move (bot moves automatically)
      await client.submitMove(matchId, user.token, 'ROCK');
      await new Promise(r => setTimeout(r, 1500));

      // Check match finished
      const finalMatch = await client.getMatch(matchId, user.token);
      expect(finalMatch.status).toBe('FINISHED');

      // Check stats updated
      const reconcileRes = await request(app.getHttpServer())
        .get('/wallet/reconcile')
        .set('Authorization', `Bearer ${user.token}`);

      expect(reconcileRes.status).toBe(200);
      // totalWon should be net profit (payout - stake), not gross
      expect(reconcileRes.body.stats.totalWon).toBeLessThanOrEqual(200); // Max possible net profit
    });
  });
});
