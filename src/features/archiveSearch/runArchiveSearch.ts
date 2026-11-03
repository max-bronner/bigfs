import { buildSearchPattern } from '../../core/buildSearchPattern';
import { collectLineMatches } from '../../core/collectLineMatches';
import { compilePathFilter } from '../../core/compilePathFilter';
import { decodeIniText } from '../../core/windows1252';
import { looksBinary } from '../../core/looksBinary';
import { createMatchScanner } from '../../node/createMatchScanner';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { getNodeUri } from '../../services/archives/nodeAddress';
import { getFileNodes } from '../../services/archives/virtualTree';
import type {
  FileResult,
  SearchRequest,
  ToSearchPage,
} from '../../webview/archiveSearch/protocol';

/** Entries a text search reads; the formats the games pack in binary would only match by accident */
const TEXT_ENTRY_PATTERN =
  /\.(ini|inc|bhav|str|txt|wnd|lua|xml|csv|cfg|scb|mll|htm|html)$/i;

/** Matches a search stops at, which is more than anyone reads in a list */
export const MATCH_LIMIT = 5000;

/** Matches taken from one entry, so a single huge file cannot use the whole limit */
const MATCHES_PER_ENTRY = 500;

/** Largest text entry read; the shipped ones are far smaller */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** Milliseconds a pattern may spend on one entry before it is given up on */
const ENTRY_TIME_LIMIT = 1000;

/** Entries a pattern may time out on before the search gives up, since a pattern that backtracks badly does so on most files */
const MAX_SLOW_ENTRIES = 3;

/** Entries collected before they are sent to the page, and the longest they wait */
const BATCH_SIZE = 20;
const BATCH_MILLISECONDS = 80;

/** What the caller of a search provides: somewhere to send messages and a way to stop it */
export interface SearchSink {
  post: (message: ToSearchPage) => void;
  isCancelled: () => boolean;
}

/** Thrown inside the read loop to leave it, which closes the archive's reader on the way out */
class StopSearch extends Error {}

/**
 * Searches the text entries of every archive and streams what it finds to
 * the sink, an archive at a time. Entries are read one by one and dropped,
 * and a pattern that takes too long on an entry is given up on for that
 * entry only. Ends with a `finished` or `failed` message.
 */
export const runArchiveSearch = async (
  archives: ArchiveModel,
  id: number,
  request: SearchRequest,
  { post, isCancelled }: SearchSink,
): Promise<void> => {
  const pattern = buildSearchPattern(request.query);

  if ('error' in pattern) {
    post({ kind: 'failed', id, message: pattern.error });
    return;
  }

  const accepts = compilePathFilter(request.include, request.exclude);
  const scan = createMatchScanner(
    pattern.source,
    pattern.flags,
    ENTRY_TIME_LIMIT,
  );
  const contextLines = Math.max(0, Math.min(request.contextLines, 10));
  const totals = { files: 0, matches: 0, searched: 0, slow: 0 };
  let isLimitHit = false;
  let isPatternSlow = false;
  let pending: FileResult[] = [];
  let lastFlush = Date.now();

  const flush = (): void => {
    if (pending.length) {
      post({ kind: 'files', id, files: pending });
      pending = [];
    }

    lastFlush = Date.now();
  };

  post({ kind: 'started', id });

  try {
    for (const root of archives.getArchiveRoots()) {
      if (isCancelled() || isLimitHit || isPatternSlow) {
        break;
      }

      post({ kind: 'progress', id, archive: root.name });

      try {
        await archives.loadArchiveOf(root);
      } catch {
        continue; // an archive that does not read holds nothing to find
      }

      const nodes = getFileNodes(root).filter((node) => {
        const size = archives.getFileSize(node);

        return (
          size > 0 &&
          size <= MAX_ENTRY_BYTES &&
          TEXT_ENTRY_PATTERN.test(node.name) &&
          accepts(node.entryPath, root.name)
        );
      });

      try {
        await archives.readFiles(
          nodes.map((node) => ({ node })),
          async ({ node }, content) => {
            if (isCancelled()) {
              throw new StopSearch();
            }

            if (looksBinary(content)) {
              return;
            }

            totals.searched += 1;

            const text = decodeIniText(content);
            const { matches, timedOut } = scan(
              text,
              Math.min(MATCHES_PER_ENTRY, MATCH_LIMIT - totals.matches),
            );

            totals.slow += timedOut ? 1 : 0;

            if (totals.slow >= MAX_SLOW_ENTRIES) {
              isPatternSlow = true;
              throw new StopSearch();
            }

            if (matches.length) {
              const { blocks, matchCount } = collectLineMatches(
                text,
                matches,
                contextLines,
              );

              totals.files += 1;
              totals.matches += matchCount;
              pending.push({
                archive: root.name,
                archiveFolder: root.archive.pathInSource.slice(
                  0,
                  -root.name.length,
                ),
                entryPath: node.entryPath,
                uri: getNodeUri(node).toString(),
                blocks,
                matchCount,
              });
            }

            if (totals.matches >= MATCH_LIMIT) {
              isLimitHit = true;
              throw new StopSearch();
            }

            if (
              pending.length >= BATCH_SIZE ||
              (pending.length && Date.now() - lastFlush >= BATCH_MILLISECONDS)
            ) {
              flush();
            }
          },
        );
      } catch {
        // Leaving on purpose, or an archive that stopped reading part way: either way the next one is searched
      }

      flush();
    }

    flush();
    post({
      kind: 'finished',
      id,
      summary: {
        fileCount: totals.files,
        matchCount: totals.matches,
        searchedCount: totals.searched,
        isLimitHit,
        isPatternSlow,
        isCancelled: isCancelled(),
        slowCount: totals.slow,
      },
    });
  } catch (error) {
    flush();
    post({
      kind: 'failed',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
