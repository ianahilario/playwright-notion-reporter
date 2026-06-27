interface NotionApiError {
  code?: string;
  message?: string;
}

export function parseNotionErrorBody(text: string): NotionApiError | null {
  try {
    const parsed = JSON.parse(text) as NotionApiError;
    if (typeof parsed.message === 'string' || typeof parsed.code === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function lines(...parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join('\n');
}

function formatAuthError(message: string): string {
  return lines(
    '[NotionReporter] Authentication failed: invalid or missing API key.',
    `Notion says: ${message}`,
    'Fix: use the Internal Integration Secret from https://www.notion.so/my-integrations',
    '     and set it as apiKey / NOTION_API_KEY in your reporter config.',
  );
}

function formatDatabaseNotFoundError(
  message: string,
  databaseId?: string,
): string {
  const idHint = databaseId
    ? `Configured databaseId: ${databaseId}`
    : undefined;

  return lines(
    '[NotionReporter] Database not found or not accessible.',
    `Notion says: ${message}`,
    idHint,
    'Fix: copy the 32-character database ID from the database URL (not the view ID).',
    '     In Notion, open the database → ⋯ → Connections → add your integration.',
  );
}

function formatAccessDeniedError(message: string): string {
  return lines(
    '[NotionReporter] Access denied to the Notion database.',
    `Notion says: ${message}`,
    'Fix: share the database with your integration via Connections in Notion.',
  );
}

function extractPropertyName(message: string): string | undefined {
  const patterns = [
    /property with name or id: ([^.]+)/i,
    /^([^.]+?) is not a property that exists/i,
    /^([^.]+?) is expected to be/i,
    /Invalid (?:select|multi_select|status) option for property "([^"]+)"/i,
    /property "([^"]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return undefined;
}

function formatValidationError(message: string): string {
  const property = extractPropertyName(message);
  const lower = message.toLowerCase();

  let category = 'Property configuration error';
  const hints: string[] = [
    'Fix: ensure column names in statusColumns / columns match your Notion database exactly.',
  ];

  if (lower.includes('is not a property that exists') || lower.includes('could not find property')) {
    category = property
      ? `Missing Notion column: "${property}"`
      : 'Missing Notion column';
    hints.push(
      '     Add the column to your Notion database, or remove/rename it in reporter config.',
    );
  } else if (lower.includes('is expected to be')) {
    category = property
      ? `Wrong property type for "${property}"`
      : 'Wrong property type';
    hints.push(
      '     Match Notion property types: Number for counts, Select for status (not Status type).',
      '     For custom columns, set the correct type in the columns config.',
    );
  } else if (lower.includes('invalid select option') || lower.includes('status option')) {
    category = property
      ? `Invalid select value for "${property}"`
      : 'Invalid select value';
    hints.push(
      '     Create matching options in Notion (e.g. "Passed" and "Failed" for status).',
    );
  } else if (lower.includes('url') || lower.includes('date')) {
    category = 'Invalid property value format';
    hints.push(
      '     Check custom column values (URLs must be valid; dates must be ISO format YYYY-MM-DD).',
    );
  }

  return lines(
    `[NotionReporter] ${category}.`,
    `Notion says: ${message}`,
    ...hints,
  );
}

export function formatNotionApiError(
  status: number,
  bodyText: string,
  context: { databaseId?: string } = {},
): string {
  const error = parseNotionErrorBody(bodyText);
  const code = error?.code;
  const message = error?.message?.trim() || bodyText.trim() || 'Unknown error';

  if (status === 401 || code === 'unauthorized') {
    return formatAuthError(message);
  }

  if (status === 404 && code === 'object_not_found') {
    if (/database/i.test(message)) {
      return formatDatabaseNotFoundError(message, context.databaseId);
    }
    return formatDatabaseNotFoundError(message, context.databaseId);
  }

  if (status === 403 || code === 'restricted_resource') {
    return formatAccessDeniedError(message);
  }

  if (code === 'validation_error' || status === 400) {
    return formatValidationError(message);
  }

  return lines(
    `[NotionReporter] Failed to create Notion record (HTTP ${status}).`,
    `Notion says: ${message}`,
    'Fix: verify apiKey, databaseId, and that column names/types match your Notion database.',
  );
}
