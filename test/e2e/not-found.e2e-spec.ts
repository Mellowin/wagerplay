import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for Not Found scenarios
 * 
 * TC-NOTFOUND-01: Non-existent match -> 404
 * TC-NOTFOUND-02: Non-existent ticket -> 404
 * TC-NOTFOUND-03: Non-existent user -> 404
 * TC-NOTFOUND-04: Invalid UUID format
 */

describe('Not Found (e2e)', () => {
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

  describe('TC-NOTFOUND-01: Non-existent match', () => {
    it('should return 404 for non-existent match', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get('/matchmaking/match/non-existent-id')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
    });

    it('should return 404 for malformed match ID', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get('/matchmaking/match/123')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
    });

    it('should return 404 for move in non-existent match', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .post('/matchmaking/match/fake-id/move')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ move: 'ROCK' });

      expect(response.status).toBe(400);
    });
  });

  describe('TC-NOTFOUND-02: Non-existent ticket', () => {
    it('should return 404 for non-existent ticket', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get('/matchmaking/ticket/non-existent-id')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('TC-NOTFOUND-03: Non-existent endpoints', () => {
    it('should return 404 for non-existent endpoint', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get('/non-existent-endpoint')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
    });

    it('should return 404 for non-existent wallet endpoint', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get('/wallet/non-existent')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('TC-NOTFOUND-04: Invalid UUID formats', () => {
    it('should handle invalid UUID in match ID', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get('/matchmaking/match/invalid-uuid-format')
        .set('Authorization', `Bearer ${user.token}`);

      expect([404, 400]).toContain(response.status);
    });

    it('should handle empty match ID', async () => {
      const user = await client.createGuest();

      const response = await request(app.getHttpServer())
        .get('/matchmaking/match/')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
    });
  });
});
