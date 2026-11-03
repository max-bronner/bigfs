import * as path from 'path';
import { getArchiveOrderKey } from '../game/install/gameView';

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

/**
 * A base archive, by its path below the install, and the files it holds. The
 * loose files of an install come as one entry marked `loose`, which the game
 * takes before every archive of that install.
 */
export interface BaseArchive {
  path: string;
  /** Which install it is in, 0 being the one the mod is delivered to and each later one beneath it */
  layer?: number;
  loose?: boolean;
  /** Lowercased, '/' separated */
  entries: ReadonlySet<string>;
}

/** Result of `buildOverrideReport`: what packing a mod's files does to each of them in the game */
export interface OverrideReport {
  /** Files no base archive holds */
  added: string[];
  /** Files the mod replaces, with the base archives it beats */
  overrides: { path: string; over: string[] }[];
  /** Files a base archive keeps, because it sorts before the mod's */
  ignored: { path: string; keptBy: string }[];
}

/** Whether a file is left out of the archive: hidden files and folders, and archives */
export const isSkippedFromPackage = (relativePath: string): boolean =>
  relativePath.split('/').some((segment) => segment.startsWith('.')) ||
  /\.big$/i.test(relativePath);

/**
 * Sorts a mod's files into added, overriding and ignored, by which archive the
 * game would load first for each path once the mod is delivered
 */
export const buildOverrideReport = (
  files: string[],
  archiveName: string,
  base: BaseArchive[],
  delivery: Delivery,
): OverrideReport => {
  const report: OverrideReport = { added: [], overrides: [], ignored: [] };
  const mine = getArchiveOrderKey(archiveName);
  const ordered = [...base].sort(
    (a, b) =>
      (a.layer ?? 0) - (b.layer ?? 0) ||
      Number(!!b.loose) - Number(!!a.loose) ||
      (getArchiveOrderKey(a.path) < getArchiveOrderKey(b.path) ? -1 : 1),
  );

  for (const file of files) {
    const key = file.replace(/\\/g, '/').toLowerCase();
    const holders = ordered.filter((archive) => archive.entries.has(key));

    if (!holders.length) {
      report.added.push(file);
      continue;
    }

    const first = holders[0];

    // Copied into the game folder the mod is an archive of the top install:
    // only what that install loads first can keep a file from it, an install
    // beneath it never does
    if (
      delivery === 'gameFolder' &&
      (first.layer ?? 0) === 0 &&
      (first.loose || getArchiveOrderKey(first.path) < mine)
    ) {
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

/**
 * Picks the folder the save dialog starts in for a packed mod: beside the mod folder. Never
 * the base game folder, or the next comparison would count the mod's own
 * archive as part of the base game; a mod folder inside the base game, which
 * has no safe sibling, packs into the home folder instead.
 */
export const getDefaultPackageFolder = (
  modFolder: string,
  bases: readonly string[],
  home: string,
): string => {
  const beside = path.dirname(modFolder);

  return bases.some((base) => isInsideOrSame(beside, base)) ? home : beside;
};

/** Whether `candidate` is `folder` or lies below it, without casing */
export const isInsideOrSame = (candidate: string, folder: string): boolean => {
  const relative = path.relative(
    path.resolve(folder).toLowerCase(),
    path.resolve(candidate).toLowerCase(),
  );

  return (
    relative === '' ||
    (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative))
  );
};

/** Renders the report as Markdown, for a preview beside the editor */
export const renderOverrideReport = (
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
