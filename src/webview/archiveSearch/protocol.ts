import type { SearchQuery } from '../../core/buildSearchPattern';
import type { MatchBlock } from '../../core/collectLineMatches';

/** What the search view asks for: the query box, the toggles, the two path boxes and the context */
export interface SearchRequest {
  query: SearchQuery;
  /** Comma separated globs on entry paths; empty takes every entry */
  include: string;
  exclude: string;
  /** Lines shown either side of a match */
  contextLines: number;
}

/** The matches found in one entry of an archive */
export interface FileResult {
  /** File name of the archive holding the entry */
  archive: string;
  /** Where the archive sits in its source, shown beside its name */
  archiveFolder: string;
  entryPath: string;
  /** The `bigfs:` uri the entry opens from */
  uri: string;
  blocks: MatchBlock[];
  matchCount: number;
}

/** How a search ended, for the line under the query */
export interface SearchSummary {
  fileCount: number;
  matchCount: number;
  /** Text entries read, whether or not they matched */
  searchedCount: number;
  /** Whether the search stopped at the result limit */
  isLimitHit: boolean;
  isCancelled: boolean;
  /** Whether the search gave up because the pattern took too long on several entries */
  isPatternSlow: boolean;
  /** Entries given up on because the pattern took too long on them */
  slowCount: number;
}

/** Message the search view's page receives */
export type ToSearchPage =
  | { kind: 'started'; id: number }
  | { kind: 'progress'; id: number; archive: string }
  | { kind: 'files'; id: number; files: FileResult[] }
  | { kind: 'finished'; id: number; summary: SearchSummary }
  | { kind: 'failed'; id: number; message: string }
  | { kind: 'focus'; query?: string };

/** Message the search view's page sends */
export type FromSearchPage =
  | { kind: 'ready' }
  | { kind: 'search'; id: number; request: SearchRequest }
  | { kind: 'cancel' }
  | {
      kind: 'open';
      uri: string;
      line: number;
      start: number;
      end: number;
    };
