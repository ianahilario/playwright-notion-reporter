import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { formatNotionApiError } from './notion-errors';

const NOTION_API_VERSION = '2026-03-11';
const FETCH_TIMEOUT_MS = 10_000;

export type NotionPropertyType =
  | 'title'
  | 'rich_text'
  | 'select'
  | 'date'
  | 'url';

export interface NotionColumn {
  column_name: string;
  value: string | undefined;
  /** Notion property type. Defaults to 'rich_text'. */
  type?: NotionPropertyType;
}

/** Column names for values the reporter computes automatically. */
export interface NotionStatusColumns {
  passed: string;
  failed: string;
  skipped: string;
  flaky: string;
  total: string;
  /** Column for total run duration in seconds. */
  duration?: string;
  /** Column for overall run outcome. Written as a select with value 'Passed' or 'Failed'. */
  status?: string;
}

export interface NotionReporterOptions {
  /** Notion integration token passed from reporter config. */
  apiKey: string;
  /** Notion database ID passed from reporter config. */
  databaseId: string;
  /** Column names for the values the reporter computes. */
  statusColumns: NotionStatusColumns;
  /** Free-form metadata columns. Skipped when value is empty. */
  columns?: NotionColumn[];
}

interface TestAttempt {
  status: TestResult['status'];
  retry: number;
}

function toNotionProperty(
  value: string,
  type: NotionPropertyType = 'rich_text',
): Record<string, unknown> {
  switch (type) {
    case 'title':
      return { title: [{ text: { content: value } }] };
    case 'select':
      return { select: { name: value } };
    case 'date':
      return { date: { start: value } };
    case 'url':
      return { url: value };
    default:
      return { rich_text: [{ text: { content: value } }] };
  }
}

class NotionReporter implements Reporter {
  private readonly options: NotionReporterOptions;
  private readonly apiKey: string;
  private readonly databaseId: string;
  private startTime = 0;
  private attempts = new Map<string, TestAttempt>();

  constructor(options: NotionReporterOptions) {
    this.options = options;
    this.apiKey = options.apiKey;
    this.databaseId = options.databaseId;
  }

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.startTime = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Always overwrite so only the last attempt per test is counted
    this.attempts.set(test.id, { status: result.status, retry: result.retry });
  }

  async onEnd(result: FullResult): Promise<void> {
    const { apiKey, databaseId } = this;

    if (!apiKey) {
      console.log(
        '[NotionReporter] Skipped: apiKey not provided. Set apiKey or NOTION_API_KEY in reporter config.',
      );
      return;
    }

    if (!databaseId) {
      console.log(
        '[NotionReporter] Skipped: databaseId not provided. Set databaseId or NOTION_DATABASE_ID in reporter config.',
      );
      return;
    }

    const duration = Math.round((Date.now() - this.startTime) / 1000);
    const counts = { passed: 0, failed: 0, skipped: 0, flaky: 0 };

    for (const attempt of this.attempts.values()) {
      if (attempt.status === 'passed' && attempt.retry > 0) {
        counts.flaky++;
      } else if (attempt.status === 'passed') {
        counts.passed++;
      } else if (
        attempt.status === 'failed' ||
        attempt.status === 'timedOut' ||
        attempt.status === 'interrupted'
      ) {
        counts.failed++;
      } else if (attempt.status === 'skipped') {
        counts.skipped++;
      }
    }

    const total = counts.passed + counts.failed + counts.skipped + counts.flaky;
    const runStatus = result.status === 'passed' ? 'Passed' : 'Failed';
    const col = this.options.statusColumns;

    const properties: Record<string, unknown> = {
      [col.passed]: { number: counts.passed },
      [col.failed]: { number: counts.failed },
      [col.skipped]: { number: counts.skipped },
      [col.flaky]: { number: counts.flaky },
      [col.total]: { number: total },
    };

    if (col.duration) properties[col.duration] = { number: duration };
    if (col.status) properties[col.status] = { select: { name: runStatus } };

    for (const column of this.options.columns ?? []) {
      if (column.value) {
        properties[column.column_name] = toNotionProperty(
          column.value,
          column.type,
        );
      }
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_API_VERSION,
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties,
        }),
        signal: abort.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          formatNotionApiError(response.status, text, { databaseId }),
        );
      } else {
        console.log(
          `[NotionReporter] Test run recorded in Notion ` +
            `(${runStatus}: ${counts.passed} passed, ${counts.failed} failed, ` +
            `${counts.skipped} skipped, ${counts.flaky} flaky — ${total} total).`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(
          `[NotionReporter] Request timed out after ${FETCH_TIMEOUT_MS / 1000}s.`,
        );
      } else {
        console.error('[NotionReporter] Error posting to Notion:', error);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  printsToStdio(): boolean {
    return true;
  }
}

export default NotionReporter;
