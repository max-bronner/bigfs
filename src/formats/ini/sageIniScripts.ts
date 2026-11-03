import { parse } from 'luaparse';

/** Lua syntax error found in a script region, at a zero-based document position */
export interface ScriptProblem {
  line: number;
  column: number;
  message: string;
}

/**
 * Finds the syntax errors in the Lua each `BeginScript` ... `EndScript` region
 * embeds, read with luaparse as Lua 5.1 (the games' scripts use nothing newer).
 * Only syntax is checked: what a script calls is the game's to resolve.
 */
export const findScriptProblems = (
  lines: string[],
  regions: { startLine: number; endLine: number }[],
): ScriptProblem[] =>
  regions.flatMap(({ startLine, endLine }) => {
    const body = lines.slice(startLine + 1, endLine).join('\n');

    try {
      parse(body, { luaVersion: '5.1', comments: false, locations: false });

      return [];
    } catch (error) {
      // luaparse recurses per nesting level; the stack is its depth limit
      if (error instanceof RangeError) {
        return [
          {
            line: startLine,
            column: 0,
            message: 'Lua: the script is nested too deeply to check',
          },
        ];
      }

      const failure = error as {
        line?: number;
        column?: number;
        message?: string;
      };

      if (typeof failure.line !== 'number') {
        return [];
      }

      return [
        {
          line: startLine + failure.line,
          column: failure.column ?? 0,
          message: `Lua: ${(failure.message ?? 'syntax error').replace(/^\[\d+:\d+\]\s*/, '')}`,
        },
      ];
    }
  });
