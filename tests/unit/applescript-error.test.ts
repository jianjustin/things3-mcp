// ABOUTME: Unit tests for turning osascript stderr into a readable error message
// ABOUTME: The message is what MCP clients and the model see in isError results

import { describeOsascriptFailure } from '../../src/utils/applescript';

describe('describeOsascriptFailure', () => {
  it('strips the source range prefix and keeps the AppleScript message', () => {
    const stderr = '34:40: execution error: Things3 got an error: Can’t get area id "nope". (-1728)\n';
    expect(describeOsascriptFailure(stderr, 1)).toBe(
      'AppleScript error: Things3 got an error: Can’t get area id "nope". (-1728)',
    );
  });

  it('keeps localized messages intact', () => {
    const stderr = '34:40: execution error: “Things3”遇到一个错误：不能获得“area id "x"”。 (-1728)';
    expect(describeOsascriptFailure(stderr, 1)).toBe(
      'AppleScript error: “Things3”遇到一个错误：不能获得“area id "x"”。 (-1728)',
    );
  });

  it('falls back to the exit code when stderr is empty', () => {
    expect(describeOsascriptFailure('', 1)).toBe('AppleScript execution failed with code 1');
  });
});
