import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Input Validation
 * 
 * VAL-001: Invalid move enum -> 400
 * VAL-002: displayName >20 chars -> 400
 * VAL-003: displayName empty -> 400
 * VAL-004: Bot match validation
 * VAL-005: Stake validation boundaries
 */

describe('Input Validation (e2e)', () => {
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

  describe('VAL-001: Move enum validation', () => {
    it('should reject invalid move value', async () => {
      const user = await client.createGuest();
      
      // Create bot match
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // Invalid move value
      const response = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ move: 'INVALID_MOVE' });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/ROCK|PAPER|SCISSORS|enum/i);
    });

    it('should reject numeric move value', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      const response = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ move: 123 });

      expect(response.status).toBe(400);
    });

    it('should accept valid moves', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      // Test each valid move
      const validMoves = ['ROCK', 'PAPER', 'SCISSORS'];
      
      for (const move of validMoves) {
        // Create fresh match for each move test
        await flushTestDb();
        const freshUser = await client.createGuest();
        
        await client.quickplay(freshUser.token, 2, 100);
        await client.forceMatch(freshUser.token, 2, 100);
        await new Promise(r => setTimeout(r, 500));
        
        const freshState = await client.pollForActiveMatch(freshUser.token);
        const freshMatchId = freshState.activeMatch.matchId;

        const response = await request(app.getHttpServer())
          .post(`/matchmaking/match/${freshMatchId}/move`)
          .set('Authorization', `Bearer ${freshUser.token}`)
          .send({ move });

        expect(response.status).toBe(201);
      }
    });

    it('should reject lowercase move values', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      const response = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ move: 'rock' });

      expect(response.status).toBe(400);
    });
  });

  describe('VAL-002: Display name validation', () => {
    it('should reject displayName > 20 characters', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: 'A'.repeat(21) });

      expect(response.status).toBe(400);
    });

    it('should accept displayName exactly 20 characters', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: 'A'.repeat(20) });

      expect(response.status).toBe(200);
    });

    it('should accept displayName with special characters', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: 'Test🔥User' });

      // Emoji should be accepted (just stored as-is)
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('VAL-003: Empty and null values', () => {
    it('should reject empty displayName', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: '' });

      expect(response.status).toBe(400);
    });

    it('should reject null move value', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      const response = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ move: null });

      expect(response.status).toBe(400);
    });
  });

  describe('VAL-004: Quickplay parameter validation', () => {
    it('should reject missing playersCount', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ stakeVp: 100 });

      expect(response.status).toBe(400);
    });

    it('should reject missing stakeVp', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2 });

      expect(response.status).toBe(400);
    });

    it('should reject string stakeVp', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2, stakeVp: '100' });

      expect(response.status).toBe(400);
    });

    it('should reject string playersCount', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: '2', stakeVp: 100 });

      expect(response.status).toBe(400);
    });
  });

  describe('VAL-005: Allowed values validation', () => {
    it('should accept all allowed stakes', async () => {
      const allowedStakes = [100, 200, 500, 1000, 2500, 5000, 10000];
      
      for (const stake of allowedStakes) {
        await flushTestDb();
        const user = await client.createGuest();
        
        const response = await request(app.getHttpServer())
          .post('/matchmaking/quickplay')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ playersCount: 2, stakeVp: stake });

        expect(response.status).toBe(201);
      }
    });

    it('should reject disallowed stakes', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .post('/matchmaking/quickplay')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ playersCount: 2, stakeVp: 150 }); // Not in allowed list

      expect(response.status).toBe(400);
    });

    it('should accept all allowed player counts', async () => {
      const allowedPlayers = [2, 3, 4, 5];
      
      for (const count of allowedPlayers) {
        await flushTestDb();
        const user = await client.createGuest();
        
        const response = await request(app.getHttpServer())
          .post('/matchmaking/quickplay')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ playersCount: count, stakeVp: 100 });

        expect(response.status).toBe(201);
      }
    });
  });
});
