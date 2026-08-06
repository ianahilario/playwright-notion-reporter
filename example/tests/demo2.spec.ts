import { expect, test } from '@playwright/test';

test('demo2 passed test', async () => {
  expect('demo2').toContain('demo');
});
