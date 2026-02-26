import { INestApplication } from '@nestjs/common';
import { TestClient } from './helpers/api';
import { flushTestDb } from './helpers/redis';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * E2E Tests for IDOR (Insecure Direct Object Reference) vulnerabilities
 * 
 * TC-IDOR-01: User A cannot read User B's ticket
 * TC-IDOR-02: User A cannot make move in User B's match
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

  describe('TC-IDOR-01: Ticket access control', () => {
    it('should return 404 when user tries to read another user ticket', async () => {
      // Create two users
      const [userA, userB] = await client.createGuests(2);

      // User A creates ticket
      const ticket = await client.quickplay(userA.token, 2, 100);
      expect(ticket.ticketId).toBeDefined();

      // User B tries to read User A's ticket
      const response = await client.getTicket(ticket.ticketId, userB.token);

      // Should return 404 (not 401/403) to hide resource existence
      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });

    it('should return 200 when user reads their own ticket', async () => {
      const user = await client.createGuest();

      const ticket = await client.quickplay(user.token, 2, 100);
      
      const response = await client.getTicket(ticket.ticketId, user.token);

      expect(response.status).toBe(200);
      expect(response.body.ticketId).toBe(ticket.ticketId);
      expect(response.body.userId).toBe(user.userId);
    });
  });

  describe('TC-IDOR-02: Match move access control', () => {
    it('should return 400 when stranger tries to make move in match', async () => {
      // Create 3 users
      const [userA, userB, stranger] = await client.createGuests(3);

      // Users A and B join match
      await client.quickplay(userA.token, 2, 100);
      await client.quickplay(userB.token, 2, 100);

      // Wait for match creation
      await new Promise(r => setTimeout(r, 1500));

      // Get match for userA
      const stateA = await client.getActiveState(userA.token);
      expect(stateA.activeMatch).toBeDefined();
      const matchId = stateA.activeMatch.matchId;

      // Stranger tries to make move
      const response = await client.submitMove(matchId, stranger.token, 'ROCK');

      // Should be rejected
      expect(response.status).toBe(400);
    });
  });
});
