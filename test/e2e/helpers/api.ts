import request from 'supertest';

export interface GuestAuth {
  userId: string;
  token: string;
}

export class TestClient {
  private server: any;

  constructor(app: any) {
    this.server = app.getHttpServer();
  }

  /**
   * Create guest account and return auth data
   */
  async createGuest(): Promise<GuestAuth> {
    const res = await request(this.server)
      .post('/auth/guest')
      .expect(201);

    return {
      userId: res.body.userId,
      token: res.body.token,
    };
  }

  /**
   * Create multiple guests in parallel
   */
  async createGuests(count: number): Promise<GuestAuth[]> {
    const promises = Array(count)
      .fill(null)
      .map(() => this.createGuest());
    return Promise.all(promises);
  }

  /**
   * Quickplay - join matchmaking
   */
  async quickplay(
    token: string,
    playersCount: number = 2,
    stakeVp: number = 100,
  ): Promise<any> {
    const res = await request(this.server)
      .post('/matchmaking/quickplay')
      .set('Authorization', `Bearer ${token}`)
      .send({ playersCount, stakeVp });

    return res.body;
  }

  /**
   * Force match creation (for tests)
   */
  async forceMatch(
    token: string,
    playersCount: number = 2,
    stakeVp: number = 100,
  ): Promise<any> {
    // Retry logic: wait for lock to be released and match to be created
    let attempts = 0;
    let res: request.Response;
    
    while (attempts < 20) {
      res = await request(this.server)
        .post('/matchmaking/test/force-match')
        .set('Authorization', `Bearer ${token}`)
        .send({ playersCount, stakeVp });
      
      if (res.body.status === 'OK' || res.body.result) {
        return res.body;
      }
      
      // If failed, wait a bit and retry
      attempts++;
      await new Promise(r => setTimeout(r, 200));
    }
    
    return res!.body;
  }

  /**
   * Get ticket by ID
   */
  async getTicket(ticketId: string, token: string): Promise<request.Response> {
    return request(this.server)
      .get(`/matchmaking/ticket/${ticketId}`)
      .set('Authorization', `Bearer ${token}`);
  }

  /**
   * Submit move
   */
  async submitMove(
    matchId: string,
    token: string,
    move: 'ROCK' | 'PAPER' | 'SCISSORS',
  ): Promise<request.Response> {
    return request(this.server)
      .post(`/matchmaking/match/${matchId}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ move });
  }

  /**
   * Get active state (queue + match)
   */
  async getActiveState(token: string): Promise<any> {
    const res = await request(this.server)
      .get('/matchmaking/active')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return res.body;
  }

  /**
   * Get match by ID
   */
  async getMatch(matchId: string, token: string): Promise<any> {
    const res = await request(this.server)
      .get(`/matchmaking/match/${matchId}`)
      .set('Authorization', `Bearer ${token}`);

    return res.body;
  }

  /**
   * Poll for active match with timeout
   * Used to handle race conditions after forceMatch
   */
  async pollForActiveMatch(token: string, maxAttempts: number = 10, interval: number = 200): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const state = await this.getActiveState(token);
      if (state.activeMatch) {
        return state;
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Timeout waiting for active match');
  }

  /**
   * Get wallet balance
   */
  async getWallet(token: string): Promise<any> {
    const res = await request(this.server)
      .get('/wallet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return res.body;
  }
}
