import { scoreFilePath } from './scoreFilePath';

/** A file a quick open list can offer */
export interface RankableFile {
  /** The file name */
  name: string;
  /** The path the file is found by, folders included */
  path: string;
  /** Identifies the file across sessions, which the recent list holds */
  key: string;
  /** Whether this is the copy to prefer when several files score alike */
  isPreferred: boolean;
}

/** Added to the score of the most recently opened file, and less for each file opened since */
const RECENT_BONUS = 60;
const RECENT_DECAY = 2;
const RECENT_FLOOR = 10;

/**
 * Picks the files a query finds, best first, as a quick open list shows
 * them. Without a query these are the recently opened files, newest first;
 * with one, a recently opened file gains a little, and of equal scores the
 * preferred copy and then the shorter path come first.
 */
export const rankFiles = <T extends RankableFile>(
  query: string,
  files: readonly T[],
  recentKeys: readonly string[],
  limit: number,
): T[] => {
  if (!query.trim()) {
    const byKey = new Map(files.map((file) => [file.key, file]));

    return recentKeys.flatMap((key) => byKey.get(key) ?? []).slice(0, limit);
  }

  const recency = new Map(
    recentKeys.map((key, index) => [
      key,
      Math.max(RECENT_FLOOR, RECENT_BONUS - index * RECENT_DECAY),
    ]),
  );
  const scored: { file: T; score: number }[] = [];

  for (const file of files) {
    const score = scoreFilePath(query, file.name, file.path);

    if (score !== undefined) {
      scored.push({ file, score: score + (recency.get(file.key) ?? 0) });
    }
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.file.isPreferred) - Number(a.file.isPreferred) ||
        a.file.path.length - b.file.path.length,
    )
    .slice(0, limit)
    .map(({ file }) => file);
};
