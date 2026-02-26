import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Input Validation
 * 
 * VAL-001: Invalid move enum → 400
 * VAL-002: displayName >20 chars → 400
 * VAL-003: displayName empty → 400
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
      const [userA, userB] = await client.createGuests(2);
      
      await client.quickplay(userA.token, 2, 100);
      await client.quickplay(userB.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(userA.token);
      const matchId = state.activeMatch.matchId;

      // Invalid move value
      const response = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ move: 'INVALID_MOVE' });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/ROCK|PAPER|SCISSORS|enum/i);
    });

    it('should reject numeric move value', async () => {
      const [userA, userB] = await client.createGuests(2);
      
      await client.quickplay(userA.token, 2, 100);
      await client.quickplay(userB.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(userA.token);
      const matchId = state.activeMatch.matchId;

      const response = await request(app.getHttpServer())
        .post(`/matchmaking/match/${matchId}/move`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ move: 123 });

      expect(response.status).toBe(400);
    });

    it('should accept valid moves', async () => {
      const [userA, userB] = await client.createGuests(2);
      
      await client.quickplay(userA.token, 2, 100);
      await client.quickplay(userB.token, 2, 100);
      await new Promise(r => setTimeout(r, 1500));

      const state = await client.getActiveState(userA.token);
      const matchId = state.activeMatch.matchId;

      const validMoves = ['ROCK', 'PAPER', 'SCISSORS'];
      
      for (const move of validMoves) {
        // Создаем новый матч для каждого теста
        const [u1, u2] = await client.createGuests(2);
        await client.quickplay(u1.token, 2, 100);
        await client.quickplay(u2.token, 2, 100);
        await new Promise(r => setTimeout(r, 1000));
        
        const s = await client.getActiveState(u1.token);
        const mid = s.activeMatch.matchId;
        
        const response = await client.submitMove(mid, u1.token, move as any);
        expect(response.status).toBe(201);
      }
    });
  });

  describe('VAL-002/003: Display name validation', () => {
    it('should reject displayName >20 chars', async () => {
      const user = await client.createGuest();
      const longName = 'A'.repeat(21);

      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: longName });

      expect(response.status).toBe(400);
    });

    it('should reject empty displayName', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: '   ' });

      expect(response.status).toBe(400);
    });

    it('should accept valid displayName', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ displayName: 'ValidName' });

      expect(response.status).toBe(200);
    });
  });
});
