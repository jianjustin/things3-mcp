#!/usr/bin/env node

// ABOUTME: Entry point for the Things3 MCP server
// ABOUTME: Serves MCP over stdio (both 2025-era and 2026-era clients) until stdin closes or a signal arrives

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('things3');

const handle = serveStdio(() => createServer(), {
  onerror: (error) => logger.error('MCP transport error', error),
});
logger.info('Things3 MCP server listening on stdio');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info(`Received ${signal}, shutting down...`);
    void handle.close().finally(() => process.exit(0));
  });
}
