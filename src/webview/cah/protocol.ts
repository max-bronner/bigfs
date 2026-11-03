/** The messages the Create-a-Hero page and its editor exchange */

/** One class or subclass choice, by its position in the INI's list */
export interface ChoiceView {
  index: number;
  label: string;
}

/** One power slot of the hero, with its button resolved against the INI */
export interface PowerView {
  slot: number;
  button: string;
  level: number;
  commandSlot: number;
  label?: string;
  specialPower?: string;
  specialPowerKnown?: boolean;
  buttonKnown?: boolean;
}

/** One bling choice of the hero; `at` is its position in the hero's list */
export interface BlingView {
  at: number;
  group: string;
  index: number;
  binder?: string;
  kind: string;
  upgrade?: string;
  label?: string;
}

/** Message carrying the hero file as the editor sends it: its record with the names resolved */
export interface HeroView {
  kind: 'hero';
  readOnly: boolean;
  hasSystem: boolean;
  name: string;
  id: string | undefined;
  isSystem: boolean | undefined;
  version: number;
  objectId: number;
  classIndex: number;
  subclassIndex: number;
  classes: ChoiceView[];
  subclasses: ChoiceView[];
  colors: { hex: string; alpha: number }[];
  points: { total: number | undefined; spent: number } | undefined;
  powers: PowerView[];
  blings: BlingView[];
  file: {
    storedCrc: number | undefined;
    /** Whether the stored checksum matches the file */
    document: boolean;
    crc: number;
    trailing: number;
  };
}

/** Notice the editor sends when it refuses an edit */
export interface CahNotice {
  kind: 'notice';
  message: string;
}

/** Messages the editor sends to the Create-a-Hero page */
export type CahToPage = HeroView | CahNotice;

/** Messages the Create-a-Hero page sends: the field that changed, with its value as typed */
export type FromCahPage =
  | { kind: 'ready' }
  | {
      kind: 'setName' | 'setId' | 'setClass' | 'setSubclass';
      value: string;
    }
  | { kind: 'setColor'; index: number; value: string }
  | {
      kind: 'setPower';
      index: number;
      field: 'button' | 'level' | 'slot';
      value: string;
    }
  | { kind: 'clearPower'; index: number }
  | { kind: 'addBling'; value: string }
  | { kind: 'removeBling'; index: number }
  | {
      kind: 'setBling';
      index: number;
      field: 'group' | 'index';
      value: string;
    };
