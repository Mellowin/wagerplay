import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for 404 Not Found handling
 * 
 * NF-001: Nonexistent match returns 404
 * NF-002: Nonexistent ticket returns 404
 * NF-003: Nonexistent user returns 404
 * NF-004: Invalid UUID format handling
 */

describe('Not Found Handling (e2e)', () => {
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

  describe('NF-001: Nonexistent match', () => {
    it('should return 404 for nonexistent match', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .get('/matchmaking/match/nonexistent-id')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
    });

    it('should return 400 for move in nonexistent match', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/match/fake-match-id/move')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ move: 'ROCK' });

      // Backend returns 400 for invalid match ID format
      expect(res.status).toBe(400);
    });

    it('should return 404 for fallback in nonexistent match', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/match/fake-id/fallback')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('NF-002: Nonexistent ticket', () => {
    it('should return 404 for nonexistent ticket', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .get('/matchmaking/ticket/nonexistent-ticket-id')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 for cancel nonexistent ticket', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .post('/matchmaking/ticket/fake-id/cancel')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('NF-003: Invalid UUID format', () => {
    it('should handle special characters in IDs gracefully', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .get('/matchmaking/match/../../../etc/passwd')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
    });

    it('should handle SQL injection attempt in match ID', async () => {
      const user = await client.createGuest();
      
      const res = await request(app.getHttpServer())
        .get('/matchmaking/match/\'; DROP TABLE users; --')
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(404);
    });
  });
});
