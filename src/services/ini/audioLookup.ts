import { createParseCache } from './workspaceText';
import { audioDefinitionOf } from '../../game/audio/sageAudioResolve';
import type { AudioLookup } from '../../game/audio/sageAudioResolve';
import { forEachBlock } from '../../formats/ini/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';
import type { SageIniIndex } from './sageIniIndex';

/** Block keywords of the definitions that name audio files, directly or through other events */
export const AUDIO_KEYWORDS = [
  'AudioEvent',
  'DialogEvent',
  'MusicTrack',
  'AmbientStream',
  'StreamedSound',
  'Multisound',
  'NewEvaEvent',
  'PredefinedEvaEvent',
];

/** A movie's definition, followed to the events its file stem names */
const VIDEO_KEYWORD = 'Video';

/** How long a parsed file serves lookups before it is read again */
const PARSE_REUSE_MS = 5000;

/** Creates the audio lookup that finds definitions by name through the index, reading them from their files */
export const createAudioLookup = (
  index: SageIniIndex,
  documents: SageIniDocuments,
): AudioLookup => {
  const cache = createParseCache(documents);
  let cachedAt = Date.now();

  return async (name) => {
    // Files are parsed once per burst of lookups, so an edit shows within seconds
    if (Date.now() - cachedAt > PARSE_REUSE_MS) {
      cache.clear();
      cachedAt = Date.now();
    }
    for (const keyword of [...AUDIO_KEYWORDS, VIDEO_KEYWORD]) {
      const [place] = index.findDefinitions(keyword, name);
      const parsed = place && (await cache.get(place.uri));

      if (!place || !parsed) {
        continue;
      }

      let found: ReturnType<typeof audioDefinitionOf> | undefined;

      forEachBlock(parsed.blocks, (block) => {
        if (!found && block.startLine === place.line) {
          found = audioDefinitionOf(parsed, block);
        }
      });
      if (found) {
        return found;
      }
    }
    return undefined;
  };
};
