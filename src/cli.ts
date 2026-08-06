#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { NotionStatusColumns } from './index';
import { createNotionRecord, type NotionColumn, type NotionReporterOptions } from './index';
import { summarizeMergedPlaywrightReport } from './merged-report';

const DEFAULT_MERGED_REPORT_PATH = './merged-report.json';
const REQUIRED_CONFIG_EXPORT = 'default';

export interface NotionReporterCliConfig {
  apiKey: string;
  databaseId: string;
  statusColumns: NotionStatusColumns;
  columns?: NotionColumn[];
}

function getConfigPath(): string {
  const configPath = process.argv[2]?.trim();
  if (!configPath) {
    throw new Error(
      'Missing config path argument. Usage: playwright-notion-reporter-cli <config.ts> [merged-report.json]',
    );
  }

  return configPath;
}

function getMergedReportPath(): string {
  const argPath = process.argv[3]?.trim();
  if (argPath) {
    return argPath;
  }

  return DEFAULT_MERGED_REPORT_PATH;
}

function toAbsolutePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

async function loadCliConfig(configPath: string): Promise<NotionReporterCliConfig> {
  const absolutePath = toAbsolutePath(configPath);
  const imported = (await loadConfigModule(absolutePath)) as {
    default?: NotionReporterCliConfig;
  };
  const config = imported[REQUIRED_CONFIG_EXPORT];

  if (!config || typeof config !== 'object') {
    throw new Error(
      `Config file must export default object with apiKey, databaseId, and statusColumns: ${absolutePath}`,
    );
  }

  if (!config.statusColumns) {
    throw new Error(
      `Config file missing required "statusColumns": ${absolutePath}`,
    );
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
    throw new Error(`Config file missing required "apiKey": ${absolutePath}`);
  }
  if (
    typeof config.databaseId !== 'string' ||
    config.databaseId.trim() === ''
  ) {
    throw new Error(`Config file missing required "databaseId": ${absolutePath}`);
  }

  if (config.columns && !Array.isArray(config.columns)) {
    throw new Error(
      `Config file field "columns" must be an array when provided: ${absolutePath}`,
    );
  }

  return config;
}

async function loadConfigModule(path: string): Promise<Record<string, unknown>> {
  const extension = extname(path).toLowerCase();

  if (extension !== '.ts') {
    return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  }

  const configSource = await readFile(path, 'utf8');
  let tsCompiler: {
    transpileModule: (
      source: string,
      options: { compilerOptions: Record<string, unknown> },
    ) => { outputText: string };
    ModuleKind: { CommonJS: number };
    ScriptTarget: { ES2020: number };
  };

  try {
    tsCompiler = (await import('typescript')) as typeof tsCompiler;
  } catch {
    throw new Error(
      'Loading .ts config needs "typescript" package installed in the consumer project.',
    );
  }

  const transpiled = tsCompiler.transpileModule(configSource, {
    compilerOptions: {
      module: tsCompiler.ModuleKind.CommonJS,
      target: tsCompiler.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} as Record<string, unknown> };
  const moduleRequire = createRequire(path);
  const wrapped = new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    transpiled,
  );
  wrapped(moduleRequire, module, module.exports, path, dirname(path));
  return module.exports;
}

async function run(): Promise<void> {
  const configPath = getConfigPath();
  const reportPath = getMergedReportPath();
  const cliConfig = await loadCliConfig(configPath);
  const content = await readFile(reportPath, 'utf8');
  const report = JSON.parse(content) as unknown;

  const options: NotionReporterOptions = {
    apiKey: cliConfig.apiKey,
    databaseId: cliConfig.databaseId,
    statusColumns: cliConfig.statusColumns,
    columns: cliConfig.columns,
  };

  const summary = summarizeMergedPlaywrightReport(report);
  await createNotionRecord(options, summary);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[NotionReporter CLI] Failed: ${message}`);
  process.exitCode = 1;
});
