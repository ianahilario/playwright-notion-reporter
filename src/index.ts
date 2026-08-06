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

export interface NotionRunCounts {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface NotionRunSummary {
  counts: NotionRunCounts;
  durationSeconds: number;
  runStatus: 'Passed' | 'Failed';
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
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

export function summarizeAttempts(
  attempts: Iterable<TestAttempt>,
): NotionRunCounts {
  const counts: NotionRunCounts = { passed: 0, failed: 0, skipped: 0, flaky: 0 };

  for (const attempt of attempts) {
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

  return counts;
}

function buildNotionProperties(
  options: NotionReporterOptions,
  summary: NotionRunSummary,
): Record<string, unknown> {
  const col = options.statusColumns;
  const counts = summary.counts;
  const total = counts.passed + counts.failed + counts.skipped + counts.flaky;

  const properties: Record<string, unknown> = {
    [col.passed]: { number: normalizeCount(counts.passed) },
    [col.failed]: { number: normalizeCount(counts.failed) },
    [col.skipped]: { number: normalizeCount(counts.skipped) },
    [col.flaky]: { number: normalizeCount(counts.flaky) },
    [col.total]: { number: normalizeCount(total) },
  };

  if (col.duration) {
    properties[col.duration] = { number: normalizeCount(summary.durationSeconds) };
  }
  if (col.status) {
    properties[col.status] = { select: { name: summary.runStatus } };
  }

  for (const column of options.columns ?? []) {
    if (column.value) {
      properties[column.column_name] = toNotionProperty(column.value, column.type);
    }
  }

  return properties;
}

export async function createNotionRecord(
  options: NotionReporterOptions,
  summary: NotionRunSummary,
): Promise<void> {
  const apiKey = options.apiKey;
  const databaseId = options.databaseId;
  const counts = summary.counts;
  const total = counts.passed + counts.failed + counts.skipped + counts.flaky;

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

  const properties = buildNotionProperties(options, summary);
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
      console.error(formatNotionApiError(response.status, text, { databaseId }));
    } else {
      console.log(
        `[NotionReporter] Test run recorded in Notion ` +
          `(${summary.runStatus}: ${counts.passed} passed, ${counts.failed} failed, ` +
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

class NotionReporter implements Reporter {
  private readonly options: NotionReporterOptions;
  private startTime = 0;
  private attempts = new Map<string, TestAttempt>();

  constructor(options: NotionReporterOptions) {
    this.options = options;
  }

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.startTime = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Always overwrite so only the last attempt per test is counted
    this.attempts.set(test.id, { status: result.status, retry: result.retry });
  }

  async onEnd(result: FullResult): Promise<void> {
    const summary: NotionRunSummary = {
      counts: summarizeAttempts(this.attempts.values()),
      durationSeconds: Math.round((Date.now() - this.startTime) / 1000),
      runStatus: result.status === 'passed' ? 'Passed' : 'Failed',
    };

    await createNotionRecord(this.options, summary);
  }

  printsToStdio(): boolean {
    return true;
  }
}

export default NotionReporter;
