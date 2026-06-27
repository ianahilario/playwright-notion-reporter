import { expect, test } from '@playwright/test';

test('passed test', async () => {
  expect(1 + 1).toBe(2);
});

test('failed test', async () => {
  expect(1 + 1).toBe(1);
});

test.skip('skipped test', async () => {
  expect(true).toBe(true);
});

test('flaky test', async ({}, testInfo) => {
  // Fails once, then passes — shows up as "Flaky" in Notion when retries > 0
  expect(testInfo.retry).toBeGreaterThan(0);
});
