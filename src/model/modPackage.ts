import { archiveOrderKey } from './gameView';

/**
 * What shipping a mod as one archive does to the game's files. Inside one
 * install the engine takes archives in order of their path below it, and
 * the first archive holding a path wins (`gameView.ts`). So an archive
 * copied into the game folder overrides a base file only when its name
 * sorts before every base archive holding that file; one loaded with
 * `-mod` is a layer of its own, put before the game, and always wins.
 */

/** How the mod reaches the game */
export type Delivery = 'gameFolder' | 'modFolder';

/** A base archive, by its path below the install, and the files it holds */
export interface BaseArchive {
  path: string;
  /** Lowercased, '/' separated */
  entries: ReadonlySet<string>;
}

export interface OverrideReport {
  /** Files no base archive holds */
  added: string[];
  /** Files the mod replaces, with the base archives it beats */
  overrides: { path: string; over: string[] }[];
  /** Files a base archive keeps, because it sorts before the mod's */
  ignored: { path: string; keptBy: string }[];
}

/** Whether a file is left out of the archive: hidden files and folders, and archives */
export const skippedFromPackage = (relativePath: string): boolean =>
  relativePath.split('/').some((segment) => segment.startsWith('.')) ||
  /\.big$/i.test(relativePath);

export const overrideReport = (
  files: string[],
  archiveName: string,
  base: BaseArchive[],
  delivery: Delivery,
): OverrideReport => {
  const report: OverrideReport = { added: [], overrides: [], ignored: [] };
  const mine = archiveOrderKey(archiveName);
  const ordered = [...base].sort((a, b) =>
    archiveOrderKey(a.path) < archiveOrderKey(b.path) ? -1 : 1,
  );

  for (const file of files) {
    const key = file.replace(/\\/g, '/').toLowerCase();
    const holders = ordered.filter((archive) => archive.entries.has(key));

    if (!holders.length) {
      report.added.push(file);
      continue;
    }

    const first = holders[0];

    if (delivery === 'gameFolder' && archiveOrderKey(first.path) < mine) {
      report.ignored.push({ path: file, keptBy: first.path });
    } else {
      report.overrides.push({
        path: file,
        over: holders.map((archive) => archive.path),
      });
    }
  }
  return report;
};

/** The report as Markdown, for a preview beside the editor */
export const reportMarkdown = (
  report: OverrideReport,
  archiveName: string,
  delivery: Delivery,
  problems: { path: string; line: number; message: string }[],
  baseKnown: boolean,
): string => {
  const list = (lines: string[]) =>
    lines.length ? lines.map((line) => `- ${line}`).join('\n') : '_none_';
  const total =
    report.added.length + report.overrides.length + report.ignored.length;

  return [
    `# Packaging ${archiveName}`,
    '',
    delivery === 'gameFolder'
      ? `Copied into the game folder, it loads by its name: it beats a base archive whose path sorts after \`${archiveName}\`, and loses to one that sorts before.`
      : 'Loaded with `-mod`, it is a layer before the game and wins over every base archive.',
    '',
    `${total} files: ${report.overrides.length} override the game, ${report.added.length} are new, ${report.ignored.length} would be ignored.`,
    ...(baseKnown
      ? []
      : [
          '',
          '> No base game folder is set (`bigfs.baseGameFolder`), so every file counts as new.',
        ]),
    '',
    `## Ignored: a base archive loads first (${report.ignored.length})`,
    '',
    list(
      report.ignored.map(
        ({ path, keptBy }) =>
          `\`${path}\`: kept by \`${keptBy}\`; rename the archive to sort before it, or load the mod with \`-mod\``,
      ),
    ),
    '',
    `## INI errors (${problems.length})`,
    '',
    list(
      problems.map(
        ({ path, line, message }) => `\`${path}:${line + 1}\`: ${message}`,
      ),
    ),
    '',
    `## Overrides (${report.overrides.length})`,
    '',
    list(
      report.overrides.map(
        ({ path, over }) =>
          `\`${path}\` over ${over.map((each) => `\`${each}\``).join(', ')}`,
      ),
    ),
    '',
    `## New (${report.added.length})`,
    '',
    list(report.added.map((path) => `\`${path}\``)),
    '',
  ].join('\n');
};
