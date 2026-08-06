import type { NotionReporterCliConfig } from './src/cli';

const config: NotionReporterCliConfig = {
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
      value: `CI reporter demo run — ${new Date().toISOString()}`,
      type: 'title',
    },
  ],
};

export default config;
