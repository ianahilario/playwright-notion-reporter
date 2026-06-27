import { describe, expect, it } from 'vitest';
import { formatNotionApiError, parseNotionErrorBody } from '../src/notion-errors';

describe('parseNotionErrorBody', () => {
  it('parses a Notion JSON error body', () => {
    expect(
      parseNotionErrorBody(
        JSON.stringify({
          code: 'object_not_found',
          message: 'Could not find database',
        }),
      ),
    ).toEqual({
      code: 'object_not_found',
      message: 'Could not find database',
    });
  });

  it('returns null for non-JSON text', () => {
    expect(parseNotionErrorBody('plain text')).toBeNull();
  });
});

describe('formatNotionApiError', () => {
  it('explains invalid API key errors', () => {
    const message = formatNotionApiError(
      401,
      JSON.stringify({
        code: 'unauthorized',
        message: 'API token is invalid.',
      }),
    );

    expect(message).toContain('Authentication failed');
    expect(message).toContain('API token is invalid');
    expect(message).toContain('NOTION_API_KEY');
  });

  it('explains database not found errors', () => {
    const message = formatNotionApiError(
      404,
      JSON.stringify({
        code: 'object_not_found',
        message:
          'Could not find database with ID: abc. Make sure the relevant pages and databases are shared with your integration.',
      }),
      { databaseId: '3711cab099ec808ea59dd9bd87da0c02' },
    );

    expect(message).toContain('Database not found or not accessible');
    expect(message).toContain('3711cab099ec808ea59dd9bd87da0c02');
    expect(message).toContain('Connections');
  });

  it('explains missing column errors', () => {
    const message = formatNotionApiError(
      400,
      JSON.stringify({
        code: 'validation_error',
        message: 'Total is not a property that exists.',
      }),
    );

    expect(message).toContain('Missing Notion column: "Total"');
    expect(message).toContain('statusColumns');
  });

  it('explains wrong property type errors', () => {
    const message = formatNotionApiError(
      400,
      JSON.stringify({
        code: 'validation_error',
        message: 'Status is expected to be select.',
      }),
    );

    expect(message).toContain('Wrong property type for "Status"');
    expect(message).toContain('Select for status');
  });

  it('explains invalid select option errors', () => {
    const message = formatNotionApiError(
      400,
      JSON.stringify({
        code: 'validation_error',
        message: 'Invalid select option for property "Status".',
      }),
    );

    expect(message).toContain('Invalid select value for "Status"');
    expect(message).toContain('Passed');
  });

  it('explains access denied errors', () => {
    const message = formatNotionApiError(
      403,
      JSON.stringify({
        code: 'restricted_resource',
        message: 'Insufficient permissions for this endpoint.',
      }),
    );

    expect(message).toContain('Access denied');
    expect(message).toContain('Connections');
  });

  it('falls back for unknown errors', () => {
    const message = formatNotionApiError(500, 'Internal Server Error');

    expect(message).toContain('Failed to create Notion record (HTTP 500)');
    expect(message).toContain('Internal Server Error');
  });
});
