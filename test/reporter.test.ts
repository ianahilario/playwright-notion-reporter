import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotionReporter, { type NotionReporterOptions } from '../src/index';

const statusColumns = {
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  flaky: 'Flaky',
  total: 'Total',
  duration: 'Duration',
  status: 'Status',
};

function baseOptions(
  overrides: Partial<NotionReporterOptions> = {},
): NotionReporterOptions {
  return {
    apiKey: 'test-api-key',
    databaseId: 'test-database-id',
    statusColumns,
    ...overrides,
  };
}

function makeTest(id: string): TestCase {
  return { id } as TestCase;
}

function makeResult(
  status: TestResult['status'],
  retry = 0,
): TestResult {
  return { status, retry } as TestResult;
}

function makeFullResult(status: FullResult['status'] = 'passed'): FullResult {
  return { status } as FullResult;
}

function parseFetchBody(fetchMock: ReturnType<typeof vi.fn>): {
  parent: { database_id: string };
  properties: Record<string, unknown>;
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe('NotionReporter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', fetchMock);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns true from printsToStdio', () => {
    const reporter = new NotionReporter(baseOptions());
    expect(reporter.printsToStdio()).toBe(true);
  });

  it('skips the Notion request when apiKey is missing', async () => {
    const reporter = new NotionReporter(
      baseOptions({ apiKey: '' }),
    );

    await reporter.onEnd(makeFullResult());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[NotionReporter] Skipped: apiKey not provided. Set apiKey or NOTION_API_KEY in reporter config.',
    );
  });

  it('skips the Notion request when databaseId is missing', async () => {
    const reporter = new NotionReporter(
      baseOptions({ databaseId: '' }),
    );

    await reporter.onEnd(makeFullResult());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts test counts and metadata to Notion', async () => {
    const reporter = new NotionReporter(
      baseOptions({
        columns: [
          { column_name: 'Branch', value: 'main', type: 'rich_text' },
          { column_name: 'Empty', value: undefined },
          { column_name: 'Run URL', value: 'https://example.com/run/1', type: 'url' },
        ],
      }),
    );

    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(makeTest('t1'), makeResult('passed'));
    reporter.onTestEnd(makeTest('t2'), makeResult('passed', 1));
    reporter.onTestEnd(makeTest('t3'), makeResult('failed'));
    reporter.onTestEnd(makeTest('t4'), makeResult('skipped'));
    reporter.onTestEnd(makeTest('t5'), makeResult('timedOut'));
    reporter.onTestEnd(makeTest('t6'), makeResult('interrupted'));

    await reporter.onEnd(makeFullResult('failed'));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.notion.com/v1/pages');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-api-key',
      'Content-Type': 'application/json',
      'Notion-Version': '2026-03-11',
    });

    const body = parseFetchBody(fetchMock);
    expect(body.parent).toEqual({ database_id: 'test-database-id' });
    expect(body.properties).toMatchObject({
      Passed: { number: 1 },
      Failed: { number: 3 },
      Skipped: { number: 1 },
      Flaky: { number: 1 },
      Total: { number: 6 },
      Status: { select: { name: 'Failed' } },
      Branch: { rich_text: [{ text: { content: 'main' } }] },
      'Run URL': { url: 'https://example.com/run/1' },
    });
    expect(body.properties).not.toHaveProperty('Empty');
    expect(body.properties.Duration).toEqual(
      expect.objectContaining({ number: expect.any(Number) }),
    );
  });

  it('only counts the last attempt per test', async () => {
    const reporter = new NotionReporter(baseOptions());
    const test = makeTest('flaky-test');

    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(test, makeResult('failed', 0));
    reporter.onTestEnd(test, makeResult('passed', 1));

    await reporter.onEnd(makeFullResult());

    const body = parseFetchBody(fetchMock);
    expect(body.properties).toMatchObject({
      Passed: { number: 0 },
      Failed: { number: 0 },
      Skipped: { number: 0 },
      Flaky: { number: 1 },
      Total: { number: 1 },
    });
  });

  it('writes custom columns using supported Notion property types', async () => {
    const reporter = new NotionReporter(
      baseOptions({
        columns: [
          { column_name: 'Title', value: 'Nightly run', type: 'title' },
          { column_name: 'Env', value: 'staging', type: 'select' },
          { column_name: 'Started', value: '2026-05-31', type: 'date' },
        ],
      }),
    );

    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(makeTest('t1'), makeResult('passed'));

    await reporter.onEnd(makeFullResult());

    const body = parseFetchBody(fetchMock);
    expect(body.properties).toMatchObject({
      Title: { title: [{ text: { content: 'Nightly run' } }] },
      Env: { select: { name: 'staging' } },
      Started: { date: { start: '2026-05-31' } },
    });
  });

  it('omits optional duration and status columns when not configured', async () => {
    const reporter = new NotionReporter(
      baseOptions({
        statusColumns: {
          passed: 'Passed',
          failed: 'Failed',
          skipped: 'Skipped',
          flaky: 'Flaky',
          total: 'Total',
        },
      }),
    );

    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(makeTest('t1'), makeResult('passed'));

    await reporter.onEnd(makeFullResult());

    const body = parseFetchBody(fetchMock);
    expect(body.properties).not.toHaveProperty('Duration');
    expect(body.properties).not.toHaveProperty('Status');
  });

  it('logs success when Notion accepts the page', async () => {
    const reporter = new NotionReporter(baseOptions());

    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(makeTest('t1'), makeResult('passed'));

    await reporter.onEnd(makeFullResult());

    expect(logSpy).toHaveBeenCalledWith(
      '[NotionReporter] Test run recorded in Notion (Passed: 1 passed, 0 failed, 0 skipped, 0 flaky — 1 total).',
    );
  });

  it('logs a helpful error when Notion rejects the request', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          code: 'object_not_found',
          message: 'Could not find database with ID: abc.',
        }),
      ),
    });

    const reporter = new NotionReporter(
      baseOptions({ databaseId: 'abc' }),
    );
    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(makeTest('t1'), makeResult('passed'));

    await reporter.onEnd(makeFullResult());

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Database not found or not accessible'),
    );
    expect(errorSpy.mock.calls[0][0]).toContain('abc');
  });

  it('logs an error when the request times out', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    const reporter = new NotionReporter(baseOptions());
    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(makeTest('t1'), makeResult('passed'));

    await reporter.onEnd(makeFullResult());

    expect(errorSpy).toHaveBeenCalledWith(
      '[NotionReporter] Request timed out after 10s.',
    );
  });

  it('logs an error for unexpected fetch failures', async () => {
    const networkError = new Error('network down');
    fetchMock.mockRejectedValue(networkError);

    const reporter = new NotionReporter(baseOptions());
    reporter.onBegin({} as never, {} as never);
    reporter.onTestEnd(makeTest('t1'), makeResult('passed'));

    await reporter.onEnd(makeFullResult());

    expect(errorSpy).toHaveBeenCalledWith(
      '[NotionReporter] Error posting to Notion:',
      networkError,
    );
  });
});
