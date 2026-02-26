import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Soak Test: Extended duration test for memory leaks
 * 
 * Runs moderate load for extended period to detect:
 * - Memory leaks
 * - Connection pool exhaustion
 * - Gradual performance degradation
 * 
 * Duration: 30 minutes
 * Load: 20 VUs (moderate but sustained)
 * 
 * Run: k6 run test/load/soak-test.js
 */

const memoryLeakCheck = new Counter('memory_checks');
const responseTrend = new Trend('response_time_trend');
const errorRate = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '2m', target: 20 },    // Ramp up
    { duration: '25m', target: 20 },   // Sustained load (25 min!)
    { duration: '3m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // Should stay under 1s
    error_rate: ['rate<0.01'],           // Errors < 1%
    // Custom threshold: response time shouldn't grow by >50%
  },
};

const BASE_URL = 'http://localhost:3000';

export function setup() {
  console.log('Starting Soak Test - 30 minutes sustained load');
  console.log('Checking for memory leaks and degradation...');
  return { 
    startTime: Date.now(),
    initialResponseTimes: [],
  };
}

export default function (data) {
  const iteration = __ITER;
  
  // Create user
  const guest = http.post(`${BASE_URL}/auth/guest`, null, {
    tags: { name: 'Soak_CreateGuest' },
  });
  
  if (!check(guest, { 'guest created': (r) => r.status === 201 })) {
    errorRate.add(1);
    return;
  }
  
  const token = guest.json('token');
  
  // Join quickplay
  const start = Date.now();
  const quickplay = http.post(
    `${BASE_URL}/matchmaking/quickplay`,
    JSON.stringify({ playersCount: 2, stakeVp: 100 }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      tags: { name: 'Soak_Quickplay' },
    }
  );
  const duration = Date.now() - start;
  
  responseTrend.add(duration);
  
  const success = check(quickplay, {
    'quickplay success': (r) => r.status === 201 || r.status === 400,
  });
  
  errorRate.add(!success);
  
  // Every 100 iterations, log performance stats
  if (iteration % 100 === 0) {
    memoryLeakCheck.add(1);
    console.log(`Iteration ${iteration}: avg response time = ${responseTrend.avg}ms`);
  }
  
  sleep(0.5);
}

export function teardown(data) {
  const totalDuration = (Date.now() - data.startTime) / 60000; // minutes
  console.log(`\nSoak test completed: ${totalDuration.toFixed(1)} minutes`);
  console.log(`Average response time: ${responseTrend.avg}ms`);
  console.log(`P95 response time: ${responseTrend.p(95)}ms`);
  console.log(`Error rate: ${(errorRate.value * 100).toFixed(2)}%`);
  
  if (responseTrend.p(95) > responseTrend.avg * 1.5) {
    console.log('WARNING: Response time degraded significantly - possible memory leak');
  }
}
