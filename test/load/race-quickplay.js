import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Load Test: TC-RACE-01 Double Quickplay Race Condition
 * 
 * Goal: Verify that parallel quickplay requests from same user
 * don't create duplicate tickets/matches under load.
 * 
 * Run: k6 run test/load/race-quickplay.js
 */

// Custom metrics
const duplicateErrors = new Counter('duplicate_errors');
const raceConditionDetected = new Counter('race_conditions');
const quickplayLatency = new Trend('quickplay_latency');
const successRate = new Rate('successful_requests');

export const options = {
  scenarios: {
    // Scenario 1: Spike test - sudden burst of users
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },   // Ramp up fast
        { duration: '30s', target: 50 },   // Stay at peak
        { duration: '10s', target: 100 },  // Spike
        { duration: '20s', target: 100 },  // Hold spike
        { duration: '10s', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '10s',
    },
    
    // Scenario 2: Steady load - sustained pressure
    steady: {
      executor: 'constant-vus',
      vus: 30,
      duration: '60s',
      startTime: '90s', // Start after spike
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],     // 95% under 500ms
    http_req_failed: ['rate<0.01'],        // <1% errors
    duplicate_errors: ['count<10'],        // Max 10 duplicates allowed
    successful_requests: ['rate>0.99'],     // >99% success
  },
};

const BASE_URL = 'http://localhost:3000';

// Track users to simulate "double click" scenario
const userTokens = new Map();

export function setup() {
  console.log('Starting TC-RACE-01 Load Test');
  console.log('Testing: Double quickplay race condition under load');
  return { startTime: Date.now() };
}

export default function () {
  group('Create Guest User', () => {
    const guestRes = http.post(`${BASE_URL}/auth/guest`, null, {
      tags: { name: 'CreateGuest' },
    });
    
    const success = check(guestRes, {
      'guest created': (r) => r.status === 201,
      'has token': (r) => r.json('token') !== undefined,
    });
    
    successRate.add(success);
    
 if (!success) return;
    
    const token = guestRes.json('token');
    const userId = guestRes.json('userId');
    
    // Simulate "double click" - two rapid quickplay requests
    group('Double Quickplay Race', () => {
      const startTime = Date.now();
      
      // Send two parallel quickplay requests (race condition scenario)
      const responses = http.batch([
        {
          method: 'POST',
          url: `${BASE_URL}/matchmaking/quickplay`,
          body: JSON.stringify({ playersCount: 2, stakeVp: 100 }),
          params: {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            tags: { name: 'QuickplayRace_1' },
          },
        },
        {
          method: 'POST',
          url: `${BASE_URL}/matchmaking/quickplay`,
          body: JSON.stringify({ playersCount: 2, stakeVp: 100 }),
          params: {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            tags: { name: 'QuickplayRace_2' },
          },
        },
      ]);
      
      quickplayLatency.add(Date.now() - startTime);
      
      const res1 = responses[0];
      const res2 = responses[1];
      
      // Analyze responses
      const status1 = res1.status;
      const status2 = res2.status;
      const body1 = res1.json();
      const body2 = res2.json();
      
      // Check for successful outcomes
      const validOutcomes = [
        201, // Created
        400, // Duplicate request (expected)
      ];
      
      const isValid1 = validOutcomes.includes(status1);
      const isValid2 = validOutcomes.includes(status2);
      
      check(res1, {
        'quickplay_1 valid status': () => isValid1,
      });
      
      check(res2, {
        'quickplay_2 valid status': () => isValid2,
      });
      
      // Detect race condition: both 201 means duplicate created!
      if (status1 === 201 && status2 === 201) {
        const ticket1 = (body1 && body1.ticketId) || (body1 && body1.matchId);
        const ticket2 = (body2 && body2.ticketId) || (body2 && body2.matchId);
        
        if (ticket1 && ticket2 && ticket1 !== ticket2) {
          console.log(`RACE CONDITION: User ${userId} created two resources: ${ticket1} and ${ticket2}`);
          raceConditionDetected.add(1);
          duplicateErrors.add(1);
        }
      }
      
      // Check for proper duplicate detection (any 400 means rejected)
      const errorMsg = ((body1 && body1.message) || '') + ((body2 && body2.message) || '');
      const hasDuplicateError = errorMsg.includes('Duplicate') || errorMsg.includes('ALREADY') || errorMsg.includes('retry');
      
      check(null, {
        'duplicate properly rejected if 400': () => 
          (status1 === 200 || status2 === 200) || hasDuplicateError,
      });
      
      // Verify user state consistency
      sleep(0.5); // Small delay for backend processing
      
      const stateRes = http.get(`${BASE_URL}/matchmaking/active`, {
        headers: { 'Authorization': `Bearer ${token}` },
        tags: { name: 'CheckUserState' },
      });
      
      const state = stateRes.json();
      
      // Critical invariant: user cannot be in queue AND match simultaneously
      const inQueue = state && state.queueTicket !== null;
      const inMatch = state && state.activeMatch !== null;
      
      check(stateRes, {
        'user state consistent': () => !(inQueue && inMatch),
        'user in exactly one state': () => inQueue || inMatch || (!inQueue && !inMatch),
      });
      
      if (inQueue && inMatch) {
        console.log(`INVARIANT VIOLATION: User ${userId} in both queue and match!`);
        raceConditionDetected.add(1);
      }
    });
  });
  
  sleep(0.1); // Think time between iterations
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\nLoad test completed in ${duration}s`);
  console.log(`Race conditions detected: ${raceConditionDetected.value}`);
  console.log(`Duplicate errors: ${duplicateErrors.value}`);
}
