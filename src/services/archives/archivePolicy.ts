import { FileSystemError } from 'vscode';
import type { ArchiveSource } from './archiveSource';
import {
  ReadOnlySourceError,
  assertWritableSource,
  isReadOnlySource,
} from './sourceAccess';

/**
 * The read-only decision every write path asks: whether a source takes
 * writes, by the id an archive or a uri names it with. A source the model
 * does not know is left writable, since no archive of it is either.
 */
export interface ArchivePolicy {
  /** Whether the archives of a source are never written to */
  isReadOnly(sourceId: string): boolean;
  /**
   * Rejects a write into a read-only source with the `NoPermissions` the
   * file system provider API asks for
   */
  ensureWritable(sourceId: string): void;
}

/**
 * Creates the policy the archive model and its operations share, reading the
 * sources afresh on each question so a rescan is seen at once
 */
export const createArchivePolicy = (
  getSources: () => readonly ArchiveSource[],
): ArchivePolicy => {
  const findSource = (sourceId: string): ArchiveSource | undefined =>
    getSources().find((each) => each.id === sourceId);

  return {
    isReadOnly: (sourceId) => {
      const source = findSource(sourceId);

      return Boolean(source && isReadOnlySource(source));
    },
    ensureWritable: (sourceId) => {
      const source = findSource(sourceId);

      if (!source) {
        return;
      }

      try {
        assertWritableSource(source);
      } catch (error) {
        if (error instanceof ReadOnlySourceError) {
          throw FileSystemError.NoPermissions(error.message);
        }

        throw error;
      }
    },
  };
};
