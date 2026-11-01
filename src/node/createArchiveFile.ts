import { open, unlink } from 'fs/promises';
import { createEmptyArchive } from '../formats/big/emptyArchive';

/**
 * Creates an archive with no entries at a path, refusing to touch a file that
 * is already there. The exclusive open is what makes that check atomic, so
 * two creations of one name cannot both succeed.
 * @throws with code `EEXIST` when the path is taken
 */
export const createArchiveFile = async (archivePath: string): Promise<void> => {
  const file = await open(archivePath, 'wx');

  try {
    const bytes = createEmptyArchive();

    await file.write(bytes, 0, bytes.length, 0);
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(archivePath).catch(() => undefined);
    throw error;
  }

  await file.close();
};
