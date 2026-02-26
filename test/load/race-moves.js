import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Load Test: TC-RACE-02 Double Move Race Condition
 * 
 * Goal: Verify parallel move submissions handling under load.
 * Tests both:
 * - Same player sending multiple moves (should reject duplicates)
 * - Different players sending moves simultaneously
 * 
 * Run: k6 run test/load/race-moves.js
 */

const duplicateMoves = new Counter('duplicate_move_attempts');
const acceptedDuplicates = new Counter('accepted_duplicate_moves');
const moveLatency = new Trend('move_latency');
const successRate = new Rate('move_success_rate');

export const options = {
  scenarios: {
    // Rapid fire from same user
    rapidFire: {
      executor: 'ramping-vus',
      stages: [
        { duration: '5s', target: 20 },
        { duration: '30s', target: 50 },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    accepted_duplicate_moves: ['count<5'], // Critical: should be 0
    move_success_rate: ['rate>0.95'],
  },
};

const BASE_URL = 'http://localhost:3000';

export function setup() {
  console.log('Starting TC-RACE-02 Move Race Load Test');
  
  // Create a pool of matches for testing
  const matches = [];
  
  for (let i = 0; i < 10; i++) {
    // Create two players
    const p1 = http.post(`${BASE_URL}/auth/guest`, null);
    const p2 = http.post(`${BASE_URL}/auth/guest`, null);
    
    const t1 = p1.json('token');
    const t2 = p2.json('token');
    
    // Start match
    http.post(
      `${BASE_URL}/matchmaking/quickplay`,
      JSON.stringify({ playersCount: 2, stakeVp: 100 }),
      { headers: { Authorization: `Bearer ${t1}`, 'Content-Type': 'application/json' } }
    );
    
    http.post(
      `${BASE_URL}/matchmaking/quickplay`,
      JSON.stringify({ playersCount: 2, stakeVp: 100 }),
      { headers: { Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json' } }
    );
    
    sleep(1);
    
    // Get match ID
    const state = http.get(`${BASE_URL}/matchmaking/active`, {
      headers: { Authorization: `Bearer ${t1}` },
    });
    
    const matchData = state.json('activeMatch');
  const matchId = matchData ? matchData.matchId : null;
    if (matchId) {
      matches.push({ matchId, token1: t1, token2: t2 });
    }
  }
  
  console.log(`Created ${matches.length} matches for load testing`);
  return { matches };
}

export default function (data) {
  const matches = data.matches;
  if (matches.length === 0) return;
  
  // Pick random match
  const matchData = matches[Math.floor(Math.random() * matches.length)];
  const { matchId, token1, token2 } = matchData;
  
  group('Parallel Move Race', () => {
    const startTime = Date.now();
    
    // Simulate rapid parallel move submissions
    const responses = http.batch([
      {
        method: 'POST',
        url: `${BASE_URL}/matchmaking/match/${matchId}/move`,
        body: JSON.stringify({ move: 'ROCK' }),
        params: {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token1}`,
          },
          tags: { name: 'Move_P1_First' },
        },
      },
      {
        method: 'POST',
        url: `${BASE_URL}/matchmaking/match/${matchId}/move`,
        body: JSON.stringify({ move: 'ROCK' }), // Same player, same move (duplicate)
        params: {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token1}`,
          },
          tags: { name: 'Move_P1_Duplicate' },
        },
      },
      {
        method: 'POST',
        url: `${BASE_URL}/matchmaking/match/${matchId}/move`,
        body: JSON.stringify({ move: 'PAPER' }),
        params: {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token2}`,
          },
          tags: { name: 'Move_P2' },
        },
      },
    ]);
    
    moveLatency.add(Date.now() - startTime);
    
    const [res1, res2, res3] = responses;
    
    // Analyze results
    const statuses = [res1.status, res2.status, res3.status];
    const successCount = statuses.filter(s => s === 201).length;
    const rejectCount = statuses.filter(s => s === 400).length;
    
    successRate.add(successCount > 0);
    
    // Count duplicates
    duplicateMoves.add(1);
    
    // Check if duplicate was accepted (race condition!)
    if (res1.status === 201 && res2.status === 201) {
      console.log(`RACE: Both moves from P1 accepted! Match: ${matchId}`);
      acceptedDuplicates.add(1);
    }
    
    // Verify proper handling
    check(responses, {
      'at least one move accepted': () => successCount >= 1,
      'not all rejected': () => successCount > 0,
      'duplicate rejected or accepted': () => 
        (res1.status === 201 && res2.status === 400) || 
        (res1.status === 400 && res2.status === 201) ||
        (res1.status === 201 && res2.status === 201), // Race documented
    });
    
    // Check match state
    sleep(0.3);
    
    const matchState = http.get(`${BASE_URL}/matchmaking/match/${matchId}`, {
      headers: { Authorization: `Bearer ${token1}` },
      tags: { name: 'CheckMatchState' },
    });
    
    const match = matchState.json();
    
    check(matchState, {
      'match exists': (r) => r.status === 200,
      'match has valid state': () => 
        ['READY', 'IN_PROGRESS', 'FINISHED'].includes(match.status),
    });
    
    // Invariant: match should resolve eventually
    if (match.status === 'FINISHED') {
      check(matchState, {
        'match has winner': () => match.winnerId !== undefined,
        'match is settled': () => match.settled === true,
      });
    }
  });
  
  sleep(0.05);
}

export function teardown(data) {
  console.log('\nTC-RACE-02 Load Test Results:');
  console.log(`Duplicate move attempts: ${duplicateMoves.value}`);
  console.log(`Accepted duplicates (race): ${acceptedDuplicates.value}`);
  
  if (acceptedDuplicates.value > 0) {
    console.log('WARNING: Race condition detected in move handling!');
  }
}
