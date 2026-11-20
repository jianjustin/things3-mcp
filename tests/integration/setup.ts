// ABOUTME: Setup file for integration tests
// ABOUTME: Provides configuration and utilities for Things3 integration testing

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env file
config({ path: resolve(process.cwd(), '.env') });

// These tests create, modify and delete items (including areas and tags matched
// by name) in the real Things3 database. Refuse to run unless explicitly enabled.
if (process.env['THINGS3_INTEGRATION'] !== '1') {
  throw new Error(
    'Integration tests write to your real Things3 database. ' +
      'Set THINGS3_INTEGRATION=1 to run them (ideally against a test Things3 setup).',
  );
}

// Set NODE_ENV to integration-test to disable logging during integration tests
process.env['NODE_ENV'] = 'integration-test';

// Increase timeout for integration tests
jest.setTimeout(120000); // 2 minutes

// Global setup for Things3 integration tests
beforeAll(() => {
  console.log('🧪 Starting Things3 Integration Tests');
  console.log('🚨 These tests require Things3 to be running on macOS');
});

afterAll(() => {
  console.log('✅ Things3 Integration Tests Complete');
});