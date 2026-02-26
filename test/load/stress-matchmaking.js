import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

/**
 * Stress Test: Matchmaking System Overall
 * 
 * Tests system behavior under extreme load:
 * - Many concurrent users
 * - Mix of operations (create, join, move)
 * - Memory and connection handling
 * 
 * Run: k6 run test/load/stress-matchmaking.js
 */

const errors = new Counter('errors');
const matchesCreated = new Counter('matches_created');
const matchesCompleted = new Counter('matches_completed');
const apiSuccess = new Rate('api_success');

export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Warm up
    { duration: '1m', target: 50 },     // Normal load
    { duration: '2m', target: 100 },    // High load
    { duration: '30s', target: 150 },   // Stress test
    { duration: '30s', target: 0 },     // Recovery
  ],
  thresholds: {
    http_req_duration: ['p(99)<2000'],   // 99% under 2s even under stress
    http_req_failed: ['rate<0.05'],       // <5% errors acceptable under stress
    errors: ['count<100'],                // Max 100 errors total
  },
};

const BASE_URL = 'http://localhost:3000';

// Test scenario weights
const SCENARIOS = {
  CREATE_MATCH: 0.4,  // 40% - create guest and join quickplay
  MAKE_MOVE: 0.4,     // 40% - make move in existing match
  CHECK_STATE: 0.2,   // 20% - check active state
};

export function setup() {
  console.log('Starting Stress Test: Matchmaking System');
  console.log('Max VUs: 150, Duration: ~4 minutes');
  return { startTime: Date.now() };
}

export default function () {
  const rand = Math.random();
  
  // Scenario 1: Create match flow
  if (rand < SCENARIOS.CREATE_MATCH) {
    executeCreateMatch();
  }
  // Scenario 2: Make move
  else if (rand < SCENARIOS.CREATE_MATCH + SCENARIOS.MAKE_MOVE) {
    executeMakeMove();
  }
  // Scenario 3: Check state
  else {
    executeCheckState();
  }
  
  sleep(0.1);
}

function executeCreateMatch() {
  // Create guest
  const guest = http.post(`${BASE_URL}/auth/guest`, null, {
    tags: { name: 'Stress_CreateGuest' },
  });
  
  if (!check(guest, { 'guest created': (r) => r.status === 201 })) {
    errors.add(1);
    return;
  }
  
  const token = guest.json('token');
  
  // Join quickplay
  const quickplay = http.post(
    `${BASE_URL}/matchmaking/quickplay`,
    JSON.stringify({ playersCount: 2, stakeVp: 100 }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      tags: { name: 'Stress_Quickplay' },
    }
  );
  
  const success = check(quickplay, {
    'quickplay success': (r) => r.status === 201 || r.status === 400,
    'quickplay no 500': (r) => r.status !== 500,
  });
  
  apiSuccess.add(success);
  
  if (quickplay.status === 201 && quickplay.json('matchId')) {
    matchesCreated.add(1);
  }
}

function executeMakeMove() {
  // This is a simplified version - in real test would need match pool
  // For now just check that API responds
  const guest = http.post(`${BASE_URL}/auth/guest`, null);
  
  if (guest.status !== 201) {
    errors.add(1);
    return;
  }
  
  const token = guest.json('token');
  
  // Try to make move (will likely fail with 400/404, but tests API resilience)
  const move = http.post(
    `${BASE_URL}/matchmaking/match/fake-match-id/move`,
    JSON.stringify({ move: 'ROCK' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      tags: { name: 'Stress_Move' },
    }
  );
  
  const success = check(move, {
    'move handled': (r) => r.status === 400 || r.status === 404 || r.status === 201,
    'move no crash': (r) => r.status !== 500,
  });
  
  apiSuccess.add(success);
}

function executeCheckState() {
  const guest = http.post(`${BASE_URL}/auth/guest`, null);
  
  if (guest.status !== 201) {
    errors.add(1);
    return;
  }
  
  const token = guest.json('token');
  
  const state = http.get(`${BASE_URL}/matchmaking/active`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: 'Stress_CheckState' },
  });
  
  const success = check(state, {
    'state check success': (r) => r.status === 200,
    'state valid json': (r) => r.json() !== null,
  });
  
  apiSuccess.add(success);
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\nStress test completed in ${duration}s`);
  console.log(`Matches created: ${matchesCreated.value}`);
  console.log(`Errors: ${errors.value}`);
  console.log(`API success rate: ${(apiSuccess.value * 100).toFixed(2)}%`);
}
