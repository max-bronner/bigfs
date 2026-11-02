/**
 * The include and exclude boxes of a search, as one test on an entry path.
 * Patterns are separated by commas and written as in VS Code's search: `*`
 * and `?` stay inside a folder name, `**` crosses folders, `{a,b}` offers a
 * choice, a pattern without a slash matches at any depth, and one that names
 * a folder takes everything below it.
 */

/** Splits a list at the commas outside braces */
const splitPatterns = (list: string): string[] => {
  const patterns: string[] = [];
  let depth = 0;
  let start = 0;

  for (const [index, character] of Array.from(list).entries()) {
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth = Math.max(0, depth - 1);
    } else if (character === ',' && depth === 0) {
      patterns.push(list.slice(start, index));
      start = index + 1;
    }
  }

  patterns.push(list.slice(start));

  return patterns.map((pattern) => pattern.trim()).filter(Boolean);
};

/** Turns the glob into the source of a regular expression that matches a whole path */
const toRegExpSource = (glob: string): string => {
  let source = '';
  let braces = 0;

  for (let at = 0; at < glob.length; at += 1) {
    const character = glob[at];

    if (character === '*' && glob[at + 1] === '*') {
      const followedBySlash = glob[at + 2] === '/';

      source += followedBySlash ? '(?:.*/)?' : '.*';
      at += followedBySlash ? 2 : 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '{') {
      braces += 1;
      source += '(?:';
    } else if (character === '}' && braces > 0) {
      braces -= 1;
      source += ')';
    } else if (character === ',' && braces > 0) {
      source += '|';
    } else {
      source += character.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
    }
  }

  return source + ')'.repeat(braces);
};

/** Compiles the patterns of one box, or nothing when the box is empty */
const compileList = (list: string): RegExp | undefined => {
  const sources = splitPatterns(list).flatMap((pattern) => {
    const glob = pattern
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '');
    const anchored = glob.includes('/') ? glob : `**/${glob}`;

    return [toRegExpSource(anchored), toRegExpSource(`${anchored}/**`)];
  });

  return sources.length
    ? new RegExp(`^(?:${sources.join('|')})$`, 'i')
    : undefined;
};

/**
 * Compiles two lists of patterns into a test that takes an entry path, with
 * the archive's file name to match a pattern that starts with it. An empty
 * include list takes every path.
 */
export const compilePathFilter = (
  include: string,
  exclude: string,
): ((entryPath: string, archiveName: string) => boolean) => {
  const included = compileList(include);
  const excluded = compileList(exclude);

  return (entryPath, archiveName) => {
    const paths = [entryPath, `${archiveName}/${entryPath}`];

    return (
      (!included || paths.some((path) => included.test(path))) &&
      !(excluded && paths.some((path) => excluded.test(path)))
    );
  };
};
