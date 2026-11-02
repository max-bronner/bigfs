import { Script, createContext } from 'vm';

/** What one scan of a text found */
export interface ScanResult {
  /** Offset and length of each match, one after the other */
  matches: number[];
  /** Whether the scan was stopped for taking too long, leaving `matches` incomplete */
  timedOut: boolean;
}

/** Scans a text for the pattern's matches, never taking longer than the limit it was created with */
export type MatchScanner = (text: string, maxMatches: number) => ScanResult;

/** The loop that runs inside the sandbox, where a time limit can stop it mid-match */
const SCAN_SCRIPT = new Script(`(() => {
  const found = [];
  const re = new RegExp(source, flags);
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }

    found.push(match.index, match[0].length);

    if (found.length >= maxMatches * 2) {
      break;
    }
  }

  return found;
})()`);

/**
 * Creates a scanner for a regular expression that runs in a sandbox with a
 * time limit per text. A pattern that backtracks without end is stopped by
 * the limit, since a regular expression cannot be interrupted any other way,
 * and the scan reports it instead of freezing the extension host.
 */
export const createMatchScanner = (
  source: string,
  flags: string,
  timeoutMilliseconds: number,
): MatchScanner => {
  const sandbox = createContext({
    source,
    flags,
    text: '',
    maxMatches: 0,
  }) as { text: string; maxMatches: number };

  return (text, maxMatches) => {
    sandbox.text = text;
    sandbox.maxMatches = maxMatches;

    try {
      const matches = SCAN_SCRIPT.runInContext(sandbox, {
        timeout: timeoutMilliseconds,
      }) as number[];

      return { matches: Array.from(matches), timedOut: false };
    } catch {
      return { matches: [], timedOut: true };
    } finally {
      sandbox.text = '';
    }
  };
};
