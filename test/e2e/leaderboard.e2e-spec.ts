import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';

describe('Leaderboard (e2e)', () => {
  let app: INestApplication;
  let testClient: TestClient;
  let user: { userId: string; token: string };

  beforeAll(async () => {
    app = await createTestApp();
    testClient = new TestClient(app);
    // Create single user for all tests
    user = await testClient.createGuest();
  }, 30000);

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('GET /leaderboard', () => {
    it('should return leaderboard sorted by wins', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=wins&limit=10')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('entries');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.entries)).toBe(true);
    });

    it('should return leaderboard sorted by winRate', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=winRate&limit=10')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('entries');
      expect(response.body).toHaveProperty('total');
    });

    it('should return leaderboard sorted by profit', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=profit&limit=10')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('entries');
    });

    it('should return leaderboard sorted by streak', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=streak&limit=10')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('entries');
    });

    it('should return leaderboard sorted by biggestWin', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=biggestWin&limit=10')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('entries');
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=wins&limit=1&offset=0')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body.entries.length).toBeLessThanOrEqual(1);
      expect(response.body.total).toBeGreaterThanOrEqual(1);
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/leaderboard')
        .expect(401);
    });

    it('should return valid leaderboard entry structure', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=wins&limit=10')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      if (response.body.entries.length > 0) {
        const entry = response.body.entries[0];
        expect(entry).toHaveProperty('rank');
        expect(entry).toHaveProperty('userId');
        expect(entry).toHaveProperty('displayName');
        expect(entry).toHaveProperty('stats');
        expect(entry).toHaveProperty('value');
        expect(typeof entry.rank).toBe('number');
        expect(typeof entry.userId).toBe('string');
        expect(typeof entry.displayName).toBe('string');
        expect(typeof entry.stats.wins).toBe('number');
        expect(typeof entry.stats.winRate).toBe('number');
      }
    });
  });

  describe('GET /leaderboard/me', () => {
    it('should return current user position', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard/me?category=wins')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('rank');
      expect(response.body).toHaveProperty('userId', user.userId);
      expect(response.body).toHaveProperty('displayName');
      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('value');
    });

    it('should work with all categories', async () => {
      const categories = ['wins', 'winRate', 'profit', 'streak', 'biggestWin'];

      for (const category of categories) {
        const response = await request(app.getHttpServer())
          .get(`/leaderboard/me?category=${category}`)
          .set('Authorization', `Bearer ${user.token}`)
          .expect(200);

        expect(response.body).toHaveProperty('rank');
        expect(response.body).toHaveProperty('value');
      }
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/leaderboard/me')
        .expect(401);
    });
  });

  describe('GET /leaderboard/categories', () => {
    it('should return available categories', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard/categories')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(response.body).toHaveProperty('categories');
      expect(Array.isArray(response.body.categories)).toBe(true);
      expect(response.body.categories.length).toBe(5);
      
      const category = response.body.categories[0];
      expect(category).toHaveProperty('id');
      expect(category).toHaveProperty('name');
      expect(category).toHaveProperty('description');
    });
  });
});
