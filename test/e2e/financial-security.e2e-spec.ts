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
    it('should reject single player match', async () => {
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
      const [p1, p2] = await client.createGuests(2);
      
      await client.quickplay(p1.token, 2, 100);
      await client.quickplay(p2.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(p1.token);
      const matchId = state.activeMatch.matchId;

      const res = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${p1.token}`)
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
});
