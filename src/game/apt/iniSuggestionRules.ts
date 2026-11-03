import type { NamedRule, ParameterRule, SuggestionKind } from './suggestionKinds';

/**
 * The fields whose values are a set in the game's INI, each with the evidence
 * for it: what mint's hosts bind to the field, or why the rule is only
 * inferred. A key listed in no table is a free or live value and offers
 * nothing.
 */

/** Parameters of engine-called functions that take a value from the INI */
export const PARAMETER_RULES: readonly ParameterRule[] = [
  {
    call: /^SetPalantirFrameState$/i,
    parameter: /^state$/i,
    kind: 'sideState',
    basis:
      "mint binds _good or _evil from the player template's Evil; the Single forms are the movie's own frames",
  },
  {
    call: /^SetFaction$/i,
    parameter: /^bttnState$/i,
    kind: 'side',
    basis: "mint binds the player template's Side; the movie adds the underscore",
  },
  {
    call: /^SetPlayerFaction$/i,
    parameter: /^faction$/i,
    kind: 'side',
    basis:
      "inferred: retail never calls it; the movie joins an underscore to the player template's Side",
  },
];

/** Surface keys whose picture is a MappedImage named in the INI; the first rule that matches wins */
export const IMAGE_RULES: readonly NamedRule[] = [
  {
    name: /FactionIcon|PlayerIcon\d*$|Tabs_Image\d+$|PlayerFaction_\d+$/i,
    kind: 'factionIcon',
    basis:
      'mint binds AptIcon plus the side (the PlayerFaction_N keys of the conflict results are inferred from their name)',
  },
  {
    name: /(^|\.)UIClip\.Level\.\d+$/i,
    kind: 'rankIcon',
    basis: 'mint binds AptRankIcon plus the side and the level',
  },
  {
    name: /^(MyPowerIcon_\d+|SelectPower_\d+_\d+|PalantirBttn_\d+)$/i,
    kind: 'powerIcon',
    basis:
      "mint binds the ButtonImage of the create-a-hero power button (one with CreateAHeroUIAllowableUpgrades); a palantir slot may also show its template's own button",
  },
  {
    name: /^Cah::ClassIcon\d+$/i,
    kind: 'classIcon',
    basis: 'mint binds the IconImage of a CreateAHeroClass',
  },
  {
    name: /^Cah::TypeIcon\d+$/i,
    kind: 'typeIcon',
    basis: 'mint binds the IconImage of a SubClass',
  },
  {
    name: /_Hero\d+Image$/i,
    kind: 'heroImage',
    basis: "mint binds the ButtonImage of an object with KindOf HERO (as its parents' fields compose)",
  },
  {
    name: /(^|[._])Portrait$|IconSlotPortrait\d*$|^StrategicVeterancy:UnitImage_\d+$/i,
    kind: 'unitPortrait',
    basis:
      "mint binds an object's SelectPortrait to the portrait and veterancy surfaces; the army icon slots are inferred",
  },
  {
    name: /^InGameSpellBook.*Image$/i,
    kind: 'spellImage',
    basis: 'mint binds the ButtonImage of the spell book command button, one that names a Science',
  },
  {
    name: /_Image$/i,
    kind: 'buttonImage',
    basis: "mint binds a command button's ButtonImage",
  },
];

/** Externs whose value is a colour built from a MultiplayerColor */
export const EXTERN_RULES: readonly NamedRule[] = [
  {
    name: /^TimeLine:PlayerColor:\d+$/i,
    kind: 'colourHex',
    basis:
      "mint writes the seat's MultiplayerColor RGBColor as 0x and the 24-bit value in hex, 0 for black",
  },
  {
    name: /^GameLoading:PlayerColor:\d+$/i,
    kind: 'colourArgb',
    basis:
      "mint writes the seat's MultiplayerColor RGBColor with alpha 255 as one decimal number",
  },
];

/** Names of the `MappedImage`s each picture kind takes, where the INI names them by pattern */
export const IMAGE_NAME_PATTERNS: Partial<Record<SuggestionKind, RegExp>> = {
  factionIcon: /^AptIcon[A-Za-z]+$/,
  rankIcon: /^AptRankIcon[A-Za-z]*\d+$/,
};
