import { describe, expect, it } from 'vitest';
import { summarizeMergedPlaywrightReport } from '../src/merged-report';

describe('summarizeMergedPlaywrightReport', () => {
  it('prefers top-level stats when they exist', () => {
    const summary = summarizeMergedPlaywrightReport({
      status: 'failed',
      stats: {
        expected: 8,
        skipped: 2,
        flaky: 1,
        unexpected: 3,
        duration: 12_345,
      },
      errors: [{ message: 'global setup failed' }],
    });

    expect(summary).toEqual({
      counts: {
        passed: 6,
        failed: 4,
        skipped: 2,
        flaky: 1,
      },
      durationSeconds: 12,
      runStatus: 'Failed',
    });
  });

  it('falls back to suite attempts when stats are missing', () => {
    const summary = summarizeMergedPlaywrightReport({
      suites: [
        {
          specs: [
            {
              tests: [
                {
                  results: [{ status: 'passed', retry: 0 }],
                },
                {
                  results: [{ status: 'failed', retry: 0 }],
                },
                {
                  results: [{ status: 'passed', retry: 1 }],
                },
                {
                  results: [{ status: 'skipped', retry: 0 }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(summary).toEqual({
      counts: {
        passed: 1,
        failed: 1,
        skipped: 1,
        flaky: 1,
      },
      durationSeconds: 0,
      runStatus: 'Failed',
    });
  });

  it('throws when report is not an object', () => {
    expect(() => summarizeMergedPlaywrightReport(null)).toThrow(
      'Playwright merged report must be a JSON object.',
    );
  });
});
