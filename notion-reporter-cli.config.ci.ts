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
      column_name: 'Run Source',
      value: 'github-actions',
      type: 'rich_text',
    },
    {
      column_name: 'Run URL',
      value: process.env.GITHUB_RUN_ID
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined,
      type: 'url',
    },
  ],
};

export default config;
