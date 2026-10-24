import type { SageBlock, SageDocument } from './sageIniParser';

/**
 * The files an INI file names: models, animations, textures and sounds, and
 * the file names each may be found under. The game resolves them by name
 * (mint's `asset-dat.md` "Resolution rule"); a mod may put them anywhere a
 * loader reads, so a reference is found when any archive or folder holds a
 * file of one of its candidate names.
 */

export type AssetKind = 'model' | 'animation' | 'texture' | 'sound';

export interface AssetReference {
  kind: AssetKind;
  /** As written */
  name: string;
  line: number;
  start: number;
  end: number;
  /** Lowercased file names, any of which satisfies the reference */
  candidates: string[];
}

const TEXTURE_EXTENSIONS = ['dds', 'tga', 'jpg', 'png'];
const SOUND_EXTENSIONS = ['wav', 'mp3'];
/** Blocks whose `Filename` names one streamed file */
const STREAMED = /^(dialogevent|musictrack|ambientstream|streamedsound)$/i;

/** A value that is not a file name: a macro, an expansion or none at all */
const NOT_A_FILE = /^(none|#.*|\$.*|.*[()#].*)$/i;

const stemOf = (name: string) => name.replace(/\.[^.\\/]*$/, '');
const baseOf = (name: string) => name.slice(name.search(/[^\\/]*$/));
const lower = (name: string) => name.toLowerCase();

/** The top-level block holding a line, which decides how a field reads */
const topBlockAt = (blocks: SageBlock[], line: number): SageBlock | undefined =>
  blocks.find((block) => block.startLine <= line && line <= block.endLine);

/** Candidate names for a texture: its stem with every texture extension */
export const textureCandidates = (name: string): string[] => {
  const stem = lower(stemOf(baseOf(name)));

  return TEXTURE_EXTENSIONS.map((extension) => `${stem}.${extension}`);
};

/** Every file reference in a parsed INI file */
export const findAssetReferences = (parsed: SageDocument): AssetReference[] => {
  const references: AssetReference[] = [];

  for (const statement of parsed.statements) {
    if (statement.kind !== 'field' || !statement.values.length) {
      continue;
    }

    const key = lower(statement.keyword.text);
    const first = statement.values[0];
    const add = (
      kind: AssetKind,
      token: { text: string; start: number; end: number },
      candidates: string[],
      name = token.text,
    ) => {
      if (!NOT_A_FILE.test(name)) {
        references.push({
          kind,
          name,
          line: statement.line,
          start: token.start,
          end: token.end,
          candidates,
        });
      }
    };

    switch (key) {
      case 'model':
      case 'modelname':
        add('model', first, [`${lower(stemOf(baseOf(first.text)))}.w3d`]);
        break;
      case 'animationname':
      case 'animation': {
        // `HIERARCHY.CLIP` or bare `CLIP`: the file is the clip's name
        const clip = first.text.slice(first.text.lastIndexOf('.') + 1);

        if (clip) {
          add('animation', first, [`${lower(clip)}.w3d`]);
        }
        break;
      }
      case 'particlename':
        add(
          /\.w3d$/i.test(first.text) ? 'model' : 'texture',
          first,
          /\.w3d$/i.test(first.text)
            ? [lower(baseOf(first.text))]
            : textureCandidates(first.text),
        );
        break;
      case 'texture':
        add('texture', first, textureCandidates(first.text));
        break;
      case 'sounds':
      case 'soundsmorning':
      case 'soundsevening':
      case 'soundsnight': {
        if (
          !/^audioevent$/i.test(
            topBlockAt(parsed.blocks, statement.line)?.keyword ?? '',
          )
        ) {
          break;
        }
        for (const token of statement.values) {
          // A variant may carry a weight: `name:2000`
          const name = token.text.replace(/:\d+$/, '');

          add(
            'sound',
            { ...token, end: token.start + name.length },
            SOUND_EXTENSIONS.map(
              (extension) => `${lower(baseOf(name))}.${extension}`,
            ),
            name,
          );
        }
        break;
      }
      case 'filename': {
        const block = topBlockAt(parsed.blocks, statement.line);

        if (block && STREAMED.test(block.keyword)) {
          const file = lower(baseOf(first.text));

          add(
            'sound',
            first,
            /\.[a-z0-9]+$/.test(file)
              ? [file]
              : SOUND_EXTENSIONS.map((extension) => `${file}.${extension}`),
          );
        }
        break;
      }
    }
  }
  return references;
};

const KIND_LABELS: Record<AssetKind, string> = {
  model: 'Model',
  animation: 'Animation',
  texture: 'Texture',
  sound: 'Sound',
};

/** The message a missing reference reports, with near names to suggest */
export const missingAssetMessage = (
  reference: AssetReference,
  suggestions: string[],
): string =>
  `${KIND_LABELS[reference.kind]} '${reference.name}' has no ${reference.candidates
    .slice(0, 2)
    .join(
      ' or ',
    )}${reference.candidates.length > 2 ? ' (or another texture format)' : ''} in any archive or folder` +
  (suggestions.length
    ? `; did you mean ${suggestions.map((name) => `'${name}'`).join(', ')}?`
    : '');

/** The names a missing-asset message suggests, as the quick fixes offer them */
export const suggestedAssetNames = (message: string): string[] => {
  const tail = /did you mean (.*)\?$/.exec(message)?.[1] ?? '';

  return [...tail.matchAll(/'([^']*)'/g)].map((match) => match[1]);
};

/** Whether a message is a missing-asset report */
export const isMissingAssetMessage = (message: string): boolean =>
  /^(Model|Animation|Texture|Sound) '.*' has no /.test(message);
