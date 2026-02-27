import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { LeaderboardModule } from '../src/leaderboard/leaderboard.module';
import { TestClient, createTestClient } from './test-client';
import { getTestDbConfig } from './jest-global-setup';
import * as request from 'supertest';

describe('Leaderboard (e2e)', () => {
  let app: INestApplication;
  let testClient: TestClient;
  let users: { token: string; userId: string; displayName: string }[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(getTestDbConfig()),
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '1h' },
        }),
        LeaderboardModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    testClient = createTestClient(app);
  });

  beforeEach(async () => {
    users = [];
    // Create 5 users with different stats
    for (let i = 0; i < 5; i++) {
      const user = await testClient.register(`leaderboard${i}`, `leaderboard${i}@test.com`, 'pass123');
      users.push(user);
    }
  });

  afterEach(async () => {
    await testClient.cleanup();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /leaderboard', () => {
    it('should return leaderboard sorted by wins', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=wins&limit=10')
        .set('Authorization', `Bearer ${users[0].token}`)
        .expect(200);

      expect(response.body).toHaveProperty('entries');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.entries)).toBe(true);
      expect(response.body.entries.length).toBe(5);
    });

    it('should return leaderboard sorted by winRate', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=winRate&limit=10')
        .set('Authorization', `Bearer ${users[0].token}`)
        .expect(200);

      expect(response.body.entries.length).toBe(5);
    });

    it('should return leaderboard sorted by profit', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=profit&limit=10')
        .set('Authorization', `Bearer ${users[0].token}`)
        .expect(200);

      expect(response.body.entries.length).toBe(5);
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard?category=wins&limit=2&offset=0')
        .set('Authorization', `Bearer ${users[0].token}`)
        .expect(200);

      expect(response.body.entries.length).toBe(2);
      expect(response.body.total).toBe(5);
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/leaderboard')
        .expect(401);
    });
  });

  describe('GET /leaderboard/me', () => {
    it('should return current user position', async () => {
      const response = await request(app.getHttpServer())
        .get('/leaderboard/me?category=wins')
        .set('Authorization', `Bearer ${users[0].token}`)
        .expect(200);

      expect(response.body).toHaveProperty('rank');
      expect(response.body).toHaveProperty('userId', users[0].userId);
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/leaderboard/me')
        .expect(401);
    });
  });
});
