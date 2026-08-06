import type { TestResult } from '@playwright/test/reporter';
import type { NotionRunSummary } from './index';
import { summarizeAttempts } from './index';

type JsonObject = Record<string, unknown>;

interface AttemptLike {
  status: TestResult['status'];
  retry: number;
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function mapStatus(value: unknown): TestResult['status'] | undefined {
  if (value === 'passed' || value === 'failed' || value === 'skipped') {
    return value;
  }
  if (value === 'timedOut' || value === 'interrupted') {
    return value;
  }
  return undefined;
}

function collectAttemptsFromSuites(
  suites: unknown,
  attempts: AttemptLike[],
): void {
  if (!Array.isArray(suites)) {
    return;
  }

  for (const suite of suites) {
    const suiteObj = asObject(suite);
    if (!suiteObj) {
      continue;
    }

    const specs = suiteObj.specs;
    if (Array.isArray(specs)) {
      for (const spec of specs) {
        const specObj = asObject(spec);
        if (!specObj || !Array.isArray(specObj.tests)) {
          continue;
        }

        for (const test of specObj.tests) {
          const testObj = asObject(test);
          if (!testObj) {
            continue;
          }

          const results = Array.isArray(testObj.results) ? testObj.results : [];
          const lastResult = results[results.length - 1];
          const resultObj = asObject(lastResult);
          const status = mapStatus(resultObj?.status);
          const retryRaw = resultObj?.retry;
          const retry = typeof retryRaw === 'number' ? retryRaw : 0;

          if (status) {
            attempts.push({ status, retry });
          }
        }
      }
    }

    collectAttemptsFromSuites(suiteObj.suites, attempts);
  }
}

export function summarizeMergedPlaywrightReport(
  report: unknown,
): NotionRunSummary {
  const reportObj = asObject(report);
  if (!reportObj) {
    throw new Error('Playwright merged report must be a JSON object.');
  }

  const stats = asObject(reportObj.stats);
  const statsSkipped = toCount(stats?.skipped);
  const statsFlaky = toCount(stats?.flaky);
  const statsUnexpected = toCount(stats?.unexpected);
  const statsFailed = toCount(stats?.failed);
  const statsTimedOut = toCount(stats?.timedOut);
  const statsInterrupted = toCount(stats?.interrupted);
  const statsErrors = Array.isArray(reportObj.errors) ? reportObj.errors.length : 0;
  const failed = statsUnexpected + statsFailed + statsTimedOut + statsInterrupted + statsErrors;

  const expected = toCount(stats?.expected);
  const statsPassed = toCount(stats?.passed);
  const passedFromStats = expected > 0 ? Math.max(0, expected - statsSkipped) : statsPassed;

  const attempts: AttemptLike[] = [];
  collectAttemptsFromSuites(reportObj.suites, attempts);
  const fallbackCounts = summarizeAttempts(attempts);

  const counts = {
    passed: passedFromStats > 0 ? passedFromStats : fallbackCounts.passed,
    failed: failed > 0 ? failed : fallbackCounts.failed,
    skipped: statsSkipped > 0 ? statsSkipped : fallbackCounts.skipped,
    flaky: statsFlaky > 0 ? statsFlaky : fallbackCounts.flaky,
  };

  const runStatus =
    reportObj.status === 'passed' || reportObj.status === 'failed'
      ? reportObj.status === 'passed'
        ? 'Passed'
        : 'Failed'
      : counts.failed > 0
        ? 'Failed'
        : 'Passed';

  const durationMs = toCount(stats?.duration ?? reportObj.duration);

  return {
    counts,
    runStatus,
    durationSeconds: Math.round(durationMs / 1000),
  };
}
