/**
 * Rules for which INI fields name a sound, and which an announcer event.
 *
 * The engine keeps one audio namespace: an `AudioEvent`, `DialogEvent`,
 * `MusicTrack`, `AmbientStream` or `StreamedSound` block, with a `Multisound`
 * as the fallback (mint's `AudioIndex`, `crates/sage/ini/src/audio.rs`). Every
 * field that plays a sound resolves into that one group, so the extension
 * answers it once here instead of per field in the generated schema, which
 * could only name `AudioEvent` and so reported the other kinds as missing.
 *
 * Contexts are shared between blocks - the five audio blocks are one context -
 * so a field is matched on the last segment of its context's name and its own
 * name, lowercased. The field lists are transcribed from mint's retail parse
 * tables (`tables/generated.rs`) and its readers (`OBJECT_SOUND_KEYWORDS`,
 * `OBJECT_EVA_KEYWORDS` in `object.rs`).
 *
 * This file knows nothing of the editor, so it runs in the unit tests.
 */

/** The definition kinds a sound name may be declared as */
export const AUDIO_NAMESPACES = [
  'AudioEvent',
  'DialogEvent',
  'MusicTrack',
  'AmbientStream',
  'StreamedSound',
  'Multisound',
] as const;

/** The definition kinds an announcer event name may be declared as */
export const EVA_NAMESPACES = ['NewEvaEvent', 'PredefinedEvaEvent'] as const;

/** Kind of name an audio field takes: a sound or an announcer event */
export type AudioReferenceKind = 'audio' | 'eva';

/** Gets the namespaces a kind of audio reference resolves into */
export const getKindNamespaces = (
  kind: AudioReferenceKind,
): readonly string[] => (kind === 'audio' ? AUDIO_NAMESPACES : EVA_NAMESPACES);

/** Lowercased audio and announcer namespaces, for telling them from the rest */
const AUDIO_NAMESPACE_KEYS: ReadonlySet<string> = new Set(
  [...AUDIO_NAMESPACES, ...EVA_NAMESPACES].map((name) => name.toLowerCase()),
);

/** Whether a namespace is one of the audio or announcer ones */
export const isAudioNamespace = (namespace: string): boolean =>
  AUDIO_NAMESPACE_KEYS.has(namespace.toLowerCase());

/**
 * Fields that take no name although they look as if they might: a priority
 * or a timeout, a file name (`Filename = x.mp3` is a block's own sample, not
 * a reference), and the keys that name a `UnitSpecificSounds` entry rather
 * than a sound.
 */
const NOT_A_NAME_FIELDS: ReadonlySet<string> = new Set([
  'filename',
  'voicepriority',
  'voiceattackchargetimeout',
  'voicemovetocampmaxcampnessatstartpoint',
  'voicemovetocampmincampnessatendpoint',
]);

/** Fields named after a sound that are numbers, whatever the prefix says */
const NUMBER_SUFFIX = /(?:scanrange|timeoutms|looptime|percent)$/;

/**
 * Pattern of a field that names a key of a `UnitSpecificSounds` block (the block's own
 * lines are the references)
 */
const NAMES_A_KEY = /^unitspecificsound(?:name)?touseas/;

/** Pattern of announcer fields: `EvaEvent*`, `*EvaEvent`, sighting events and announcements */
const EVA_FIELD =
  /^(?:evaevent|evaenemy|evaonfirstsighting|announcementevent)|evaevent$/;

/** Announcer-named fields that hold a flag, or a name list this does not follow */
const NOT_EVA_FIELDS: ReadonlySet<string> = new Set([
  'shouldplayunderattackevaevent',
  'suppressevaeventforremoval',
  'useslaverascontrolforevaobjectsightedevents',
  'otherevaeventstoblock',
]);

/**
 * Fields that name a sound in whichever block they appear: a voice line, a
 * sound state of an object, and the sound slots of modules, weapons,
 * upgrades and the living world. Every one is a name nothing else uses.
 */
const AUDIO_FIELD_PREFIX = /^(?:voice|sound(?!s|state$|upgrade$))/;

const AUDIO_FIELDS: ReadonlySet<string> = new Set([
  // Weapon
  'firesound',
  'overridevoiceattacksound',
  'overridevoiceenterstateattacksound',
  // Upgrade, command button
  'researchsound',
  'unitspecificsound',
  'setautoabilityunitsound',
  'unsetautoabilityunitsound',
  // Special powers and special abilities
  'initiatesound',
  'initiateatlocationsound',
  'packsound',
  'unpacksound',
  'prepsoundloop',
  'activeloopsound',
  'triggersound',
  'soundtoplay',
  'pingsound',
  'loudpingsound',
  'discoveredsound',
  'initiatevoice',
  // Modules
  'entersound',
  'exitsound',
  'beingbuiltsound',
  'selfbuildingloop',
  'selfrepairfromdamageloop',
  'selfrepairfromrubbleloop',
  'burningsoundname',
  'speedbonusaudioloop',
  'totalcrushsound',
  'backendcrushsound',
  'frontendcrushsound',
  'damagedtosound',
  'repairedtosound',
  'suppliesdepletedvoice',
  'lightpointsupsound',
  // Battle plans
  'bombardmentplanpacksoundname',
  'bombardmentplanunpacksoundname',
  'holdthelineplanpacksoundname',
  'holdthelineplanunpacksoundname',
  'searchanddestroyplanpacksoundname',
  'searchanddestroyplanunpacksoundname',
  'searchanddestroyplanidleloopsoundname',
  'bombardmentannouncementname',
  'holdthelineannouncementname',
  'searchanddestroyannouncementname',
  // Living world
  'onselectedsound',
  'onmoveplannedsound',
  'onmovestartedsound',
  'welcomereinforcementssound',
  'kickoutreinforcementssound',
  'disbandunitsound',
  'onbuildingdestroyedsound',
  'onconstructionbegunsound',
  'onconstructionfinishedsound',
  'battlemarkercreatedsound',
  'entermapsound',
  'animrayscreatesound',
  'regionconqueredsound',
  // Player template, campaign and game data
  'loadscreenmusic',
  'loadscreenmusictrack',
  'objectiveaddedsound',
  'objectivecompletedsound',
  'basictutorialloadscreenmusictrack',
  'basictutorialloadscreenvoicetrack',
  'advancedtutorialloadscreenmusictrack',
  'advancedtutorialloadscreenvoicetrack',
  'skirmishmusictrack',
  'skirmishvoicetrack',
  // Notifications and weather
  'openaudio',
  'weathersound',
]);

/**
 * Fields whose meaning depends on the block: the last segment of the
 * context's name, then the lowercased field, or every field of the block.
 */
const SCOPED_AUDIO_FIELDS: Record<string, readonly string[] | '*'> = {
  // The key lists of an object's own sounds: every line names a sound
  unitspecificsounds: '*',
  miscaudio: '*',
  multisound: ['subsounds'],
  sidesound: ['sound'],
  sound: ['name', 'sound', 'duck'],
  largegroupaudiomap: ['sound'],
  livingworldsound: ['sound'],
  livingworldplayertemplate: ['music', 'autoresolveloop'],
  act: ['audioevent'],
  session: ['audio'],
  slowdeathbehavior: ['sound'],
  clearancetestingslowdeathbehavior: ['sound'],
  giantbirdslowdeathbehavior: ['sound'],
  shipslowdeathbehavior: ['sound'],
  instantdeathbehavior: ['sound'],
  // ModelCondition carries `Sound:` among its keyed values
  modelconditionaudioloopclientbehavior: ['modelcondition'],
  animationsoundclientbehavior: ['animationsound'],
};

/** Gets the last segment of a context's path name, lowercased */
export const getLastContextSegment = (contextName: string): string =>
  contextName.split('>').pop()?.trim().toLowerCase() ?? '';

/**
 * Classifies a field of a block as naming a sound, an announcer event, or neither.
 * `contextName` is the schema's name for the context the field sits in, such
 * as `FXList > Sound`; only its last segment is read.
 */
export const getAudioReferenceKind = (
  contextName: string,
  field: string,
): AudioReferenceKind | undefined => {
  const name = field.toLowerCase();

  if (NOT_A_NAME_FIELDS.has(name) || NAMES_A_KEY.test(name)) {
    return undefined;
  }

  const scoped = SCOPED_AUDIO_FIELDS[getLastContextSegment(contextName)];

  if (scoped === '*' || scoped?.includes(name)) {
    return 'audio';
  }

  if (EVA_FIELD.test(name)) {
    return NUMBER_SUFFIX.test(name) || NOT_EVA_FIELDS.has(name)
      ? undefined
      : 'eva';
  }

  return AUDIO_FIELDS.has(name) ||
    (AUDIO_FIELD_PREFIX.test(name) && !NUMBER_SUFFIX.test(name))
    ? 'audio'
    : undefined;
};
