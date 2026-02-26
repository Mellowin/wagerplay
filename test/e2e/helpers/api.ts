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
}
