const SOUND_EXTENSIONS = ['wav', 'mp3'];

/** Lists the file names a variant may be stored under, in the order they are tried; the first found plays */
export const listSoundFileNames = (name: string): string[] => {
  const base = name.replace(/^.*[\\/]/, '').toLowerCase();

  return /\.[a-z0-9]+$/.test(base)
    ? [base]
    : SOUND_EXTENSIONS.map((extension) => `${base}.${extension}`);
};
