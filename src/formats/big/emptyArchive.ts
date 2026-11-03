import { computeArchiveLayout, serializeIndexTable } from './bigFormat';

/**
 * Bytes of padding between the index table and the data in every shipped
 * BIG4 archive
 */
const BIG4_TRAILER_LENGTH = 8;

/**
 * Builds the bytes of an archive holding no entries: a BIG4 header, which is
 * the magic the games' bulk archives carry, and the trailer they put before
 * the data. Both readers accept it, and the first entry saved into it is
 * laid out like any other.
 */
export const createEmptyArchive = (): Buffer =>
  serializeIndexTable(
    'BIG4',
    computeArchiveLayout([], new Uint8Array(BIG4_TRAILER_LENGTH)),
  );
