/** The messages the Create-a-Hero page and its editor exchange */

/** A class or subclass the hero can have, by its position in the INI's list */
export interface ChoiceView {
  index: number;
  label: string;
}

/** One power slot of the hero */
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

/** One bling choice of the hero */
export interface BlingView {
  at: number;
  group: string;
  index: number;
  binder?: string;
  kind: string;
  upgrade?: string;
  label?: string;
}

/** The hero file as the editor sends it: its record with the names resolved */
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

/** What the editor sends besides the hero: a refused edit */
export interface CahNotice {
  kind: 'notice';
  message: string;
}

export type CahToPage = HeroView | CahNotice;

/** What the page sends: the field that changed, by its value as typed */
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
