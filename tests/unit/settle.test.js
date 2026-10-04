import assert from 'node:assert/strict';
import test from 'node:test';

import { settleWithConcurrency } from '../../src/lib/utils.js';

test('tasks settle in input order, never more than the limit at a time', async () => {
  let running = 0;
  let maxRunning = 0;
  const progress = [];
  const results = await settleWithConcurrency(
    [30, 10, 20, 5, 15],
    2,
    async (delay) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running -= 1;
      if (delay === 20) {
        throw new Error('twenty');
      }
      return delay * 2;
    },
    (settled) => progress.push(settled),
  );

  assert.equal(maxRunning, 2);
  assert.deepEqual(progress, [1, 2, 3, 4, 5]);
  assert.deepEqual(
    results.map((result) => (result.status === 'fulfilled' ? result.value : result.reason.message)),
    [60, 20, 'twenty', 10, 30],
  );
});

test('an empty list settles at once', async () => {
  assert.deepEqual(await settleWithConcurrency([], 4, () => assert.fail('no task should run')), []);
});
