import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Spike Test: Sudden traffic burst
 * 
 * Simulates viral moment / tournament start when
 * thousands of users suddenly connect.
 * 
 * Run: k6 run test/load/spike-test.js
 */

const droppedRequests = new Counter('dropped_requests');
const recoveredRequests = new Counter('recovered_requests');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },    // Normal
        { duration: '5s', target: 200 },    // SPIKE! +190 users in 5s
        { duration: '30s', target: 200 },   // Hold
        { duration: '5s', target: 10 },     // Drop back
        { duration: '30s', target: 10 },    // Recovery check
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.10'],  // Allow up to 10% errors during spike
    http_req_duration: ['p(95)<3000'], // Max 3s even during spike
  },
};

const BASE_URL = 'http://localhost:3000';

export default function () {
  const res = http.post(`${BASE_URL}/auth/guest`, null, {
    tags: { name: 'Spike_CreateGuest' },
  });
  
  const success = check(res, {
    'request handled': (r) => r.status !== 0, // Not connection refused
    'no timeout': (r) => r.status !== 504,
  });
  
  if (!success) {
    droppedRequests.add(1);
  } else if (res.status === 201) {
    recoveredRequests.add(1);
  }
}

export function teardown() {
  console.log(`Dropped during spike: ${droppedRequests.value}`);
  console.log(`Successfully handled: ${recoveredRequests.value}`);
  
  if (droppedRequests.value > recoveredRequests.value * 0.1) {
    console.log('WARNING: System struggled with spike - consider auto-scaling');
  }
}
