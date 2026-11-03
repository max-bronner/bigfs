/** Nested includes followed before a file is left as written */
const MAX_DEPTH = 4;

/** Lines an expansion may reach, so a file that includes itself or a mod's huge tree cannot fill the memory */
const MAX_LINES = 200_000;

const INCLUDE_PATTERN = /^\s*#include\s+"([^"]*)"/i;

/**
 * Replaces each `#include "path"` line with the lines of the file it names, as
 * the engine's loader does: the text of an include is part of the block it is
 * written in. A path `readInclude` finds nothing for is left as written.
 */
export const expandIniIncludes = async (
  lines: readonly string[],
  readInclude: (path: string) => Promise<string[] | undefined>,
): Promise<string[]> => {
  const expanded: string[] = [];
  const expand = async (source: readonly string[], depth: number) => {
    for (const line of source) {
      const path = INCLUDE_PATTERN.exec(line)?.[1];
      const included =
        path && depth < MAX_DEPTH ? await readInclude(path) : undefined;

      if (included) {
        await expand(included, depth + 1);
      } else if (expanded.length < MAX_LINES) {
        expanded.push(line);
      }
      if (expanded.length >= MAX_LINES) {
        return;
      }
    }
  };

  await expand(lines, 0);
  return expanded;
};
