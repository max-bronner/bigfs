import { stripComment, tokenize } from '../ini/sageIniParser';
import type { SageToken } from '../ini/sageIniParser';

/** One line of a block: its keyword and values, with columns */
export interface IniLine {
  line: number;
  keyword: SageToken;
  values: SageToken[];
  /** The module slot a line sits in, empty at the definition's own level */
  module: string;
  /** The module type the slot names, `System` for the bare `System` slot */
  moduleType: string;
  /** Which of the definition's modules it sits in, -1 for none */
  moduleIndex: number;
}

/** A module block: its slot, the type it names and where it opens */
export interface IniModule {
  slot: string;
  type: string;
  line: number;
}

/** A definition found in text, with its fields in order */
export interface IniDefinition {
  keyword: string;
  name: string;
  startLine: number;
  endLine: number;
  lines: IniLine[];
  modules: IniModule[];
}

const SLOTS = new Set(
  [
    'System',
    'EmissionVelocity',
    'EmissionVolume',
    'Color',
    'Update',
    'Draw',
    'Physics',
    'Alpha',
    'Wind',
    'Event',
    'Emitter',
  ].map((slot) => slot.toLowerCase()),
);

/** Block keywords of the file-scope definitions this module reads */
export const DEFINITION_KEYWORDS = [
  'FXParticleSystem',
  'ParticleSystem',
  'FXList',
] as const;

const isEnd = (word: string) => /^end$/i.test(word);

/**
 * Finds every particle system and FX list defined at file scope in `text`. A
 * module opens on a slot keyword (block form) or on any bare word (an FX
 * list's nuggets); everything else is a field.
 */
export const findParticleDefinitions = (text: string): IniDefinition[] => {
  const lines = text.split(/\r?\n/);
  const found: IniDefinition[] = [];
  let open: IniDefinition | undefined;
  let module: { slot: string; type: string } | undefined;

  lines.forEach((raw, line) => {
    const tokens = tokenize(stripComment(raw));
    const [keyword, ...values] = tokens;

    if (!keyword) {
      return;
    }

    if (!open) {
      const kind = DEFINITION_KEYWORDS.find(
        (candidate) => candidate.toLowerCase() === keyword.text.toLowerCase(),
      );

      if (kind && values[0]) {
        open = {
          keyword: kind,
          name: values[0].text,
          startLine: line,
          endLine: line,
          lines: [],
          modules: [],
        };
      }
      return;
    }

    if (isEnd(keyword.text)) {
      if (module) {
        module = undefined;
      } else {
        open.endLine = line;
        found.push(open);
        open = undefined;
      }
      return;
    }

    const hasEquals = /=/.test(stripComment(raw));
    const opensModule =
      !module &&
      (open.keyword === 'FXParticleSystem'
        ? SLOTS.has(keyword.text.toLowerCase())
        : open.keyword === 'FXList' && !hasEquals);

    if (opensModule) {
      module = { slot: keyword.text, type: values[0]?.text ?? keyword.text };
      open.modules.push({ ...module, line });
      return;
    }

    open.lines.push({
      line,
      keyword,
      values,
      module: module?.slot ?? '',
      moduleType: module?.type ?? '',
      moduleIndex: module ? open.modules.length - 1 : -1,
    });
  });

  return found;
};

/** Parses a number with an optional one-letter `X:` prefix, or NaN */
export const parseIniNumber = (text: string): number => {
  const match = /^(?:[A-Za-z]:)?(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)%?$/i.exec(
    text,
  );

  return match ? Number(match[1]) : NaN;
};
