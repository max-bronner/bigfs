import type { ScriptSite, SaveSession } from './saveSession';
import { TextSaveError } from './textSaveError';

/** Compiles every script the text changed, once per block */
export const saveScripts = (session: SaveSession): void => {
  const byBlock = new Map<number, ScriptSite[]>();

  for (const site of session.sites) {
    byBlock.set(site.block, [...(byBlock.get(site.block) ?? []), site]);
  }

  for (const [block, sites] of byBlock) {
    const texts = new Set(sites.map((site) => site.after.text));
    const changed = sites.find((site) => site.after.text !== site.before.text);

    if (!changed) {
      continue;
    }
    if (texts.size > 1) {
      throw new TextSaveError(
        `This script runs in ${sites.length} places (lines ${sites
          .map((site) => (site.after.line ?? 0) + 1)
          .join(', ')}); edit every copy alike`,
        changed.after.line,
      );
    }
    if (changed.before.mode === 'listing') {
      throw new TextSaveError(
        'This block shows as a listing, which cannot be compiled back',
        changed.after.line,
      );
    }
    if (changed.after.mode === 'listing') {
      throw new TextSaveError(
        'A listing cannot be compiled; write the script in an ```as fence',
        changed.after.line,
      );
    }

    try {
      session.replaceScript(block, changed.after);
    } catch (error) {
      throw new TextSaveError(
        `The script does not compile: ${error instanceof Error ? error.message : String(error)}`,
        changed.after.line,
      );
    }
  }
};
