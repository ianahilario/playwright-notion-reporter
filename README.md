# playwright-notion-reporter

A [Playwright reporter](https://playwright.dev/docs/test-reporters) that creates a row in a Notion database after each test run with pass/fail counts, flaky test detection, and optional metadata columns.

## Installation

```bash
npm install playwright-notion-reporter
```

`@playwright/test` must already be installed in your project.

## Notion setup

### 1. Create an integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Click **New integration** and give it a name (e.g. `notion-playwright-reporter`).
3. Copy the **Internal Integration Secret** — this is your `NOTION_API_KEY`.

### 2. Create a database

Create a database for test runs with these properties:

| Column | Notion type | Required |
|---|---|---|
| Passed | Number | Yes |
| Failed | Number | Yes |
| Skipped | Number | Yes |
| Flaky | Number | Yes |
| Total | Number | Yes |
| Duration | Number | No |
| Status | **Select** (not Status) | No — options: `Passed`, `Failed` |
| Name | Title | No — only if you map it in `columns` |

Property names must match your `statusColumns` config exactly.

### 3. Connect the integration to your database

The integration only has access to pages and databases you explicitly connect it to. This step is required — without it you will get a `404 object_not_found` error even with a correct database ID.

1. Open the **database as a full page** (not just an inline table embedded in another page).
2. Click **⋯** in the top-right corner of the database.
3. Click **Connections** (or **Add connections**).
4. Search for your integration by name and select it.
5. Confirm it appears under **Active connections**.

If the database lives inside a page in a teamspace, you can also connect from the parent page:

1. Open the **page** that contains the database.
2. Click **⋯** → **Connections** → add your integration there.

Connecting at the page level grants access to content on that page, including embedded databases. When in doubt, connect directly on the database itself.

### 4. Copy the database ID

Open the database as a full page and copy the 32-character ID from the URL:

```
https://www.notion.so/workspace/3711cab099ec808ea59dd9bd87da0c02?v=3711cab099ec80578dce000c0fe64a33
                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                              use this segment (no dashes)
```

Use the ID in the URL path, **not** the `v=` view parameter. The reporter sends the ID as-is — no UUID conversion is applied.

## Usage

Add the reporter to `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    [
      'playwright-notion-reporter',
      {
        apiKey: process.env.NOTION_API_KEY!,
        databaseId: process.env.NOTION_DATABASE_ID!,
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
            column_name: 'Branch',
            value: process.env.GITHUB_REF_NAME,
            type: 'rich_text',
          },
          {
            column_name: 'Run URL',
            value: process.env.GITHUB_SERVER_URL
              ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
              : undefined,
            type: 'url',
          },
        ],
      },
    ],
  ],
});
```

Store secrets in environment variables — never commit your Notion API key.

If `apiKey` or `databaseId` is missing, the reporter logs a specific skip message and does not fail the test run.

## Configuration

### `NotionReporterOptions`

| Option | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | Yes | Notion integration token |
| `databaseId` | `string` | Yes | Target Notion database ID |
| `statusColumns` | `NotionStatusColumns` | Yes | Maps computed values to Notion property names |
| `columns` | `NotionColumn[]` | No | Extra metadata columns; skipped when `value` is empty |

### `statusColumns`

| Key | Required | Notion type | Description |
|---|---|---|---|
| `passed` | Yes | Number | Tests that passed on the first attempt |
| `failed` | Yes | Number | Tests that failed, timed out, or were interrupted |
| `skipped` | Yes | Number | Skipped tests |
| `flaky` | Yes | Number | Tests that passed after at least one retry |
| `total` | Yes | Number | Sum of passed, failed, skipped, and flaky |
| `duration` | No | Number | Run duration in seconds |
| `status` | No | Select | Overall outcome: `Passed` or `Failed` |

### Custom columns

Each entry in `columns` has:

| Field | Type | Description |
|---|---|---|
| `column_name` | `string` | Notion property name |
| `value` | `string \| undefined` | Value to write; omitted when falsy |
| `type` | `NotionPropertyType` | Defaults to `rich_text` |

Supported `type` values: `title`, `rich_text`, `select`, `date`, `url`.

## How counts are computed

- **Passed** — final attempt status is `passed` with no retries.
- **Flaky** — final attempt status is `passed` after one or more retries.
- **Failed** — final attempt status is `failed`, `timedOut`, or `interrupted`.
- **Skipped** — final attempt status is `skipped`.

Only the last attempt per test is counted.

## Error messages

When a Notion API call fails, the reporter prints a categorized message with fix steps instead of raw JSON:

| Error | What it means |
|---|---|
| Authentication failed | Invalid or missing API key |
| Database not found or not accessible | Wrong database ID, or integration not connected to the database/page |
| Missing Notion column | A configured column name doesn't exist in the database |
| Wrong property type | Column exists but has the wrong type (e.g. Status type instead of Select) |
| Invalid select value | Select option missing (e.g. `Passed` / `Failed` not created in Notion) |

Example:

```
[NotionReporter] Database not found or not accessible.
Notion says: Could not find database with ID: ...
Configured databaseId: 3711cab099ec808ea59dd9bd87da0c02
Fix: copy the 32-character database ID from the database URL (not the view ID).
     In Notion, open the database → ⋯ → Connections → add your integration.
```

## Try it locally

This repo includes a sample Playwright setup for end-to-end testing of the reporter.

1. Copy the env template and fill in your credentials:

   ```bash
   cp .env.secret.example .env.secret
   ```

   ```bash
   NOTION_API_KEY=secret_your_integration_token
   NOTION_DATABASE_ID=3711cab099ec808ea59dd9bd87da0c02
   ```

2. Connect your integration to the database (see [step 3 above](#3-connect-the-integration-to-your-database)).

3. Run the example tests:

   ```bash
   npm install
   npm run test:example
   ```

This runs sample tests (pass, skip, flaky) and writes a row to your Notion database. See `example/tests/demo.spec.ts` and `playwright.config.ts` for reference.

## Development

```bash
git clone <repo-url>
cd playwright-notion-reporter
npm install
npm run build      # compile src/ → dist/
npm test           # unit tests (vitest)
npm run test:example  # sample Playwright run against Notion
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `404 object_not_found` | Connect the integration via **Connections** on the database or parent page |
| `401 unauthorized` | Check `NOTION_API_KEY` matches your integration secret |
| `Total is not a property that exists` | Add a **Total** Number column to the database |
| `Status is expected to be select` | Change **Status** from Status type to **Select** with `Passed` / `Failed` options |
| Empty number columns in Notion | Verify column names in config match Notion exactly (case-sensitive) |

## License

ISC
