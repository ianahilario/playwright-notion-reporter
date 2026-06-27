/// <reference types="node" />
import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({
  path: [`./.env.secret`]
});

export default defineConfig({
  testDir: './example/tests',
  retries: 1,
  reporter: [
    ['list'],
    [
      './dist/index.js',
      {
        apiKey: process.env.NOTION_API_KEY ?? '',
        databaseId: process.env.NOTION_DATABASE_ID ?? '',
        statusColumns: {
          passed: 'Passed',
          failed: 'Failed',
          skipped: 'Skipped',
          flaky: 'Flaky',
          total: 'Total',
          duration: 'Duration',
          status: 'Status',
        },
        columns: [
          {
            column_name: 'Name',
            value: `Local demo run — ${new Date().toISOString()}`,
            type: 'title',
          },
        ],
      },
    ],
  ],
});
