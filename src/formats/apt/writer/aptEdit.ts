import type { Matrix2, Rect } from '../aptMovie';
import type { FrameSpec, TimelineOperation } from '../aptTimeline';

/** A change to one character's own fields */
export type CharacterChange =
  | { field: 'bounds'; value: Rect }
  /** A Text character's own placement */
  | { field: 'matrix'; value: Matrix2 }
  | { field: 'translate'; value: [number, number] }
  /** A font's glyph ids; the table is appended and repointed */
  | { field: 'glyphs'; value: number[] }
  | { field: 'text' | 'variable' | 'fontName'; value: string | undefined }
  | {
      field:
        | 'color'
        | 'fontHeight'
        | 'alignment'
        | 'font'
        | 'readonly'
        | 'multiline'
        | 'wordwrap'
        | 'texture'
        | 'geometry'
        | 'startShape'
        | 'endShape';
      value: number;
    };

/** A change to one PlaceObject record */
export interface PlacementChange {
  character?: number;
  depth?: number;
  matrix?: Matrix2;
  translate?: [number, number];
  /** Memory order R, G, B, A */
  colorTransform?: number;
  colorAdd?: number;
  ratio?: number;
  /** An empty string removes the name */
  name?: string;
  clipDepth?: number;
  /** Sets the "move" bit: modify what is at the depth instead of placing anew */
  isMove?: boolean;
  /**
   * Fields to turn off: their flag is cleared and the stored value left, as
   * the game leaves stale values behind unset flags. Applied before the
   * fields given, so a field both cleared and given ends up set.
   */
  clear?: PlacementField[];
}

/** A PlaceObject field a flag bit gates, which `PlacementChange.clear` can turn off */
export type PlacementField =
  | 'character'
  | 'matrix'
  | 'colorTransform'
  | 'ratio'
  | 'name'
  | 'clipDepth';

/** A change to one run of a Text character; glyphs are appended and repointed */
export interface TextRecordChange {
  font?: number;
  /** R, G, B, A, as the parser reads them */
  color?: [number, number, number, number];
  unknown?: Rect;
  penOffset?: [number, number];
  textHeight?: number;
  glyphs?: { index: number; advance: number }[];
}

/** A change to one `.const` item: a number in place, a string appended and repointed */
export interface ConstItemChange {
  index: number;
  value: string | number;
}

/** One edit to a movie, as the inspector sends it */
export type AptEdit =
  | { kind: 'character'; id: number; change: CharacterChange }
  | { kind: 'placement'; offset: number; change: PlacementChange }
  | {
      kind: 'buttonRecord';
      offset: number;
      flags?: number;
      matrix?: Matrix2;
      translate?: [number, number];
      character?: number;
      depth?: number;
      /** Multiply colour, floats R, G, B, A */
      color?: [number, number, number, number];
      unknown?: [number, number, number, number];
    }
  | {
      kind: 'frameLabel';
      offset: number;
      label?: string;
      flags?: number;
      frame?: number;
    }
  | { kind: 'backgroundColor'; offset: number; color: number }
  | {
      kind: 'addBackgroundColor';
      timeline: number;
      frame: number;
      color: number;
    }
  /** Repoints an InitAction at another sprite; its block is a script edit */
  | { kind: 'initAction'; offset: number; sprite: number }
  | { kind: 'removeObjectDepth'; offset: number; depth: number }
  | { kind: 'textRecord'; id: number; index: number; change: TextRecordChange }
  | { kind: 'addTextRecord'; id: number; font: number }
  | { kind: 'removeTextRecord'; id: number; index: number }
  /** The Movie record's word at +36, whose meaning is unknown */
  | { kind: 'movieUnknown36'; value: number }
  | { kind: 'export'; index: number; name?: string; character?: number }
  | { kind: 'addExport'; name: string; character: number }
  | { kind: 'removeExport'; index: number }
  | {
      kind: 'import';
      index: number;
      movie?: string;
      name?: string;
      /** The placeholder slot the import fills */
      character?: number;
    }
  | { kind: 'addImport'; movie: string; name: string }
  | { kind: 'removeImport'; index: number }
  | { kind: 'screen'; width: number; height: number }
  | { kind: 'duplicateCharacter'; id: number }
  | {
      kind: 'addCharacter';
      type: 'editText' | 'sprite' | 'shape' | 'image' | 'button';
    }
  /** Shows a character in a button's states (bit 0 up, 1 over, 2 down, 3 hit test) */
  | {
      kind: 'addButtonRecord';
      id: number;
      flags: number;
      character: number;
      depth: number;
      matrix?: Matrix2;
      translate?: [number, number];
      /** Multiply colour, floats R, G, B, A; white when absent */
      color?: [number, number, number, number];
      unknown?: [number, number, number, number];
    }
  | { kind: 'removeButtonRecord'; id: number; index: number }
  /** Moves a button record to another position, which changes what draws over what */
  | { kind: 'moveButtonRecord'; id: number; from: number; to: number }
  /** Empties a character's slot, as an import slot is; ids after it keep theirs */
  | { kind: 'removeCharacter'; id: number }
  | {
      kind: 'placeObject';
      timeline: number;
      frame: number;
      depth: number;
      character: number;
      translate?: [number, number];
      matrix?: Matrix2;
      name?: string;
    }
  | { kind: 'removeObject'; timeline: number; frame: number; depth: number }
  | { kind: 'addFrameLabel'; timeline: number; frame: number; label: string }
  | { kind: 'removeItem'; timeline: number; frame: number; offset: number }
  /** Moves a frame item to another position in its frame; items run in that order */
  | {
      kind: 'moveItem';
      timeline: number;
      frame: number;
      from: number;
      to: number;
    }
  | { kind: 'addFrame'; timeline: number }
  /** Runs a compiled block when a frame of a timeline is shown */
  | { kind: 'addFrameScript'; timeline: number; frame: number; block: number }
  /** Runs a compiled block when a button meets a condition (SWF bit order) */
  | { kind: 'addButtonAction'; id: number; condition: number; block: number }
  | { kind: 'buttonAction'; id: number; index: number; condition: number }
  | { kind: 'removeButtonAction'; id: number; index: number }
  /** Runs a compiled block on clip events of a placed sprite */
  | { kind: 'addClipAction'; offset: number; events: number; block: number }
  | { kind: 'clipAction'; offset: number; index: number; events: number }
  | { kind: 'removeClipAction'; offset: number; index: number }
  /** Exchanges two depths in every frame of a timeline, which reorders what draws on top */
  | { kind: 'swapDepths'; timeline: number; a: number; b: number }
  /** Rewrites a timeline's frames, as `encodeTimeline` gives them */
  | { kind: 'setTimeline'; timeline: number; frames: FrameSpec[] }
  /** Runs a timeline operation (a tween, hiding for a range, retiming) and writes the result */
  | { kind: 'timeline'; timeline: number; operation: TimelineOperation }
  /** Runs several, each on what the one before made, as one edit */
  | {
      kind: 'timelineScript';
      timeline: number;
      operations: TimelineOperation[];
    };

/** What an edit made, for the inspector to select */
export interface EditResult {
  /** The id of a character the edit added */
  character?: number;
}
