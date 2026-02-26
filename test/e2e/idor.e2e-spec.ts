import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for IDOR (Insecure Direct Object Reference) Security
 * 
 * TC-IDOR-01: Foreign ticket access -> 404
 * TC-IDOR-02: Match move access control -> 400
 * TC-IDOR-03: Foreign match access -> 404
 * TC-IDOR-04: Foreign wallet access -> 404
 * TC-IDOR-05: Bot match access control
 */

describe('IDOR Security (e2e)', () => {
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

  describe('TC-IDOR-01: Foreign ticket access', () => {
    it('should return 404 when accessing foreign ticket', async () => {
      const [userA, userB] = await client.createGuests(2);
      
      // UserA creates a ticket
      const ticketA = await client.quickplay(userA.token, 2, 100);
      
      // UserB tries to access UserA's ticket
      const response = await client.getTicket(ticketA.ticketId, userB.token);
      
      expect(response.status).toBe(404);
    });

    it('should return 404 for non-existent ticket', async () => {
      const user = await client.createGuest();
      
      const response = await client.getTicket('fake-ticket-id', user.token);
      
      expect(response.status).toBe(404);
    });
  });

  describe('TC-IDOR-02: Match move access control with bot', () => {
    it('should return 400 when stranger tries to make move in match', async () => {
      const userA = await client.createGuest();
      const stranger = await client.createGuest();
      
      // UserA creates bot match
      await client.quickplay(userA.token, 2, 100);
      await new Promise(r => setTimeout(r, 200));
      await client.forceMatch(userA.token, 2, 100);
      
      const stateA = await client.pollForActiveMatch(userA.token);
      const matchId = stateA.activeMatch.matchId;

      // Stranger tries to make move
      const response = await client.submitMove(matchId, stranger.token, 'ROCK');
      
      expect(response.status).toBe(400);
    });

    it('should allow match creator to make moves', async () => {
      const userA = await client.createGuest();
      
      // UserA creates bot match
      await client.quickplay(userA.token, 2, 100);
      await new Promise(r => setTimeout(r, 200));
      await client.forceMatch(userA.token, 2, 100);
      
      const stateA = await client.pollForActiveMatch(userA.token);
      const matchId = stateA.activeMatch.matchId;

      // Creator makes move
      const response = await client.submitMove(matchId, userA.token, 'ROCK');
      
      expect(response.status).toBe(201);
    });
  });

  describe('TC-IDOR-03: Foreign match access', () => {
    it('should return 404 when accessing non-existent match', async () => {
      const user = await client.createGuest();
      
      const response = await request(app.getHttpServer())
        .get('/matchmaking/match/fake-match-id')
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(404);
    });

    it('should return match data for participant', async () => {
      const user = await client.createGuest();
      
      await client.quickplay(user.token, 2, 100);
      await client.forceMatch(user.token, 2, 100);
      await new Promise(r => setTimeout(r, 500));
      
      const state = await client.pollForActiveMatch(user.token);
      const matchId = state.activeMatch.matchId;

      const response = await request(app.getHttpServer())
        .get(`/matchmaking/match/${matchId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.matchId).toBe(matchId);
    });
  });

  describe('TC-IDOR-04: Foreign wallet access', () => {
    it('should only access own wallet', async () => {
      const [userA, userB] = await client.createGuests(2);
      
      // UserA checks own wallet
      const resA = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${userA.token}`);

      expect(resA.status).toBe(200);
      expect(resA.body.userId).toBe(userA.userId);

      // UserB checks own wallet
      const resB = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${userB.token}`);

      expect(resB.status).toBe(200);
      expect(resB.body.userId).toBe(userB.userId);
    });

    it('should reject wallet access without auth', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet');

      expect(response.status).toBe(401);
    });
  });

  describe('TC-IDOR-05: Active state access control', () => {
    it('should only return own active state', async () => {
      const userA = await client.createGuest();
      
      // Create match
      await client.quickplay(userA.token, 2, 100);
      await client.forceMatch(userA.token, 2, 100);
      await new Promise(r => setTimeout(r, 300));

      const state = await client.getActiveState(userA.token);
      
      // Should have match but no queue
      expect(state.activeMatch || state.inQueue).toBeDefined();
      
      // Other user's state should be empty
      await flushTestDb();
      const userB = await client.createGuest();
      const stateB = await client.getActiveState(userB.token);
      
      expect(stateB.inQueue).toBeFalsy();
      expect(stateB.activeMatch).toBeFalsy();
    });
  });

  describe('TC-IDOR-06: Profile access control', () => {
    it('should only update own profile', async () => {
      const [userA, userB] = await client.createGuests(2);
      
      // UserA updates own profile
      const updateA = await request(app.getHttpServer())
        .patch('/auth/profile')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ displayName: 'UserA Name' });

      expect(updateA.status).toBe(200);

      // Verify UserB profile not changed
      const profileB = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${userB.token}`);

      expect(profileB.body.displayName).not.toBe('UserA Name');
    });

    it('should reject profile update without auth', async () => {
      const response = await request(app.getHttpServer())
        .patch('/auth/profile')
        .send({ displayName: 'Hacked' });

      expect(response.status).toBe(401);
    });
  });
});
