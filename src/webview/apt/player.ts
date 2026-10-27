import { Vm } from "./avm/vm";
import type { EngineHooks } from "./avm/vm";
import type { StageHost } from "./avm/value";
import type {
  Behaviour,
  TimelineCommand,
} from "../../formats/apt/aptBehaviour";
import type {
  ButtonRecord,
  Character,
  Frame,
  Matrix2,
} from "../../formats/apt/aptMovie";
import type { PageMovie } from "./protocol";
import { displayList, framesOf } from "./timeline";
import type { ColorTransform } from "./timeline";

/**
 * A small APT player: every placed character is an instance, every
 * timeline instance keeps its own playhead, and buttons keep their state,
 * the way a Flash player runs them (mint's player, after Ruffle). Scripts
 * are not run; what an action block does to timelines (`gotoAndPlay`,
 * `stop`, ...) is, from the behaviours the extension read out of it.
 *
 * Kept free of the DOM: the page draws and picks, this decides what is
 * shown.
 */

/** Button states, as record flags and event dispatch use them */
export const UP = 1;
export const OVER = 2;
export const DOWN = 4;
const HIT = 8;

/** SWF button conditions, bit by bit (mint's apt-format research) */
export const CONDITION = {
  rollOver: 0x1,
  rollOut: 0x2,
  press: 0x4,
  release: 0x8,
  releaseOutside: 0x40,
};

/** Gotos that run frame scripts that goto again stop here */
const MAX_CHAIN = 16;
const MAX_DEPTH = 12;
/** Scripts one frame, event or call may start between them */
const MAX_ACTIONS = 1000;

export interface Resolved {
  movie: PageMovie;
  id: number;
  character: Character;
}

export interface Instance {
  /** Depths down from the root, `/` separated; a button record is `b<depth>` */
  path: string;
  movie: PageMovie;
  id: number;
  /** Absent for an import nothing fills */
  character?: Character;
  /** The import's `movie:name`, for one nothing fills */
  missing?: string;
  parent?: Instance;
  /** The instance name it was placed with */
  name?: string;
  /** Where it sits in its parent */
  matrix: Matrix2;
  translate: [number, number];
  alpha: number;
  /** For a mask: the deepest depth above it that it clips */
  clipDepth?: number;
  /** `onClipEvent` handlers its placement carries */
  clipActions?: { events: number; block: number }[];
  /** The colour a script set with `Color`, over what the timeline places */
  tint?: ColorTransform;
  /** False once a script hides it */
  visible?: boolean;
  /** A text field's text, once a script sets it */
  text?: string;
  /** Moved by a script, so its timeline no longer moves it */
  scripted?: boolean;
  /** Made by a script (`attachMovie`, ...) rather than placed by the timeline */
  dynamic?: boolean;
  /** Taken off the stage; its running code stops */
  removed?: boolean;
  /** The frame its parent placed it in, which tells a move from a new instance */
  born: number;
  /** The character id it was placed with, before any import resolved it */
  placed: number;
  /** The PlaceObject records it came from in its parent's timeline, if any */
  placedItem?: number;
  matrixItem?: number;
  frames: Frame[];
  frame: number;
  playing: boolean;
  /** Placed children by depth; a button's shown records by `b<depth>` */
  children: Map<string, Instance>;
  /** A button's hit-test records */
  hits: Instance[];
  buttonState: number;
  /** A state the inspector holds the button in */
  forced?: number;
  /** The tick it was created in; it starts playing on the next */
  created: number;
}

export interface PlayerOptions {
  resolve: (movie: PageMovie, id: number) => Resolved | undefined;
  /** Whether nested timelines run their frame scripts */
  scripts: boolean;
  /** Whether the root does too; off to step through its frames */
  rootScripts: boolean;
  log?: (line: string) => void;
  /**
   * The engine's side: given, scripts run as bytecode on the AVM and ask
   * it what the game would answer; without, only what they do to
   * timelines is played
   */
  engine?: EngineHooks;
}

/** Clip event bits, as `scriptSites.ts` names them */
const CLIP_EVENT = {
  load: 1 << 0,
  enterFrame: 1 << 1,
  unload: 1 << 2,
  initialize: 1 << 9,
  construct: 1 << 18,
};

/** Script handlers a button or clip object can carry, by pointer event */
const HANDLERS: Record<number, string> = {
  [CONDITION.rollOver]: "onRollOver",
  [CONDITION.rollOut]: "onRollOut",
  [CONDITION.press]: "onPress",
  [CONDITION.release]: "onRelease",
  [CONDITION.releaseOutside]: "onReleaseOutside",
};

const isTimeline = (instance: Instance) =>
  instance.character?.type === "sprite" || instance.character?.type === "movie";

export class Player implements StageHost {
  public readonly root: Instance;
  public ticks = 0;
  /** The ActionScript machine, when an engine answers for the game */
  public readonly vm?: Vm;
  private chain = 0;
  /** Scripts waiting for the one running to finish */
  private readonly waiting: (() => void)[] = [];
  private draining = false;

  public constructor(
    movie: PageMovie,
    id: number,
    private readonly options: PlayerOptions,
  ) {
    if (options.engine) {
      this.vm = new Vm(this, options.engine);
    }
    // Scripts wait until the root exists, as mint's apt-player runs actions
    // only once it has a root; one that reads `_root` would find nothing
    this.draining = true;
    try {
      this.queueInitActions(movie);
      this.root = this.create(movie, id, "", undefined, {
        matrix: [1, 0, 0, 1],
        translate: [0, 0],
        alpha: 1,
        born: 0,
      });
    } finally {
      this.draining = false;
    }
    this.idle();
  }

  /**
   * Queues every init action of a movie's timelines, to run as the root
   * before the first frame (mint's queue_init_actions, after Ruffle's
   * preload), not when the frame holding one is entered
   */
  private queueInitActions(movie: PageMovie): void {
    const vm = this.vm;

    if (!vm) {
      return;
    }
    const timelines = [
      movie.frames,
      ...movie.characters.flatMap((character) =>
        character.type === "sprite"
          ? [movie.spriteFrames[character.id] ?? []]
          : [],
      ),
    ];

    for (const frames of timelines) {
      for (const frame of frames) {
        for (const item of frame.items) {
          const key = `${movie.name}#${item.type === "initAction" ? item.sprite : ""}`;

          if (item.type === "initAction" && !vm.initialised.has(key)) {
            vm.initialised.add(key);
            this.later(() => vm.runBlock(this.root, item.block));
          }
        }
      }
    }
  }

  /** Advances every playing timeline a frame, parents first */
  public tick(): void {
    this.ticks++;

    const timelines: Instance[] = [];
    const gather = (instance: Instance) => {
      if (isTimeline(instance)) {
        timelines.push(instance);
      }
      instance.children.forEach(gather);
    };

    gather(this.root);
    for (const timeline of timelines) {
      if (
        this.attached(timeline) &&
        timeline.playing &&
        timeline.created < this.ticks &&
        timeline.frames.length > 1
      ) {
        this.enter(timeline, (timeline.frame + 1) % timeline.frames.length);
      }
    }

    const vm = this.vm;

    if (vm && this.scriptsRun(this.root)) {
      vm.ticks = this.ticks;
      for (const instance of this.all()) {
        if (instance.clipActions) {
          this.clipEvent(instance, CLIP_EVENT.enterFrame);
        }

        // Only a clip a script has touched can carry an onEnterFrame
        const object = vm.peekObject(instance);
        const handler = object?.has("onEnterFrame")
          ? object.get("onEnterFrame")
          : undefined;

        if (handler !== undefined && object) {
          vm.callFromEngine(handler, object, []);
        }
      }
      vm.runIntervals();
    }
  }

  // ---- StageHost, what scripts do to clips

  /**
   * Runs the scripts waiting their turn. A frame a script's goto enters
   * queues its script to run after the one that went, as Flash queues
   * them (Ruffle's action queue, mint's drain_actions), so scripts that
   * goto each other take turns instead of nesting without end.
   */
  public idle(): void {
    if (!this.vm || this.draining || this.vm.busy) {
      return;
    }
    this.draining = true;
    try {
      for (let ran = 0; this.waiting.length; ran++) {
        if (ran >= MAX_ACTIONS) {
          this.options.log?.(
            `stopped after ${MAX_ACTIONS} scripts in one go: scripts keep starting each other`,
          );
          this.waiting.length = 0;
          break;
        }
        this.waiting.shift()!();
      }
    } finally {
      this.draining = false;
    }
  }

  private later(run: () => void): void {
    this.waiting.push(run);
  }

  public setPlaying(clip: Instance, playing: boolean): void {
    clip.playing = playing;
  }

  /**
   * Places a copy of an exported symbol (`linkage`) or of a clip (`#id`)
   * on a clip, at a depth, under a name
   */
  public attach(
    parent: Instance,
    linkage: string,
    name: string,
    depth: number,
  ): Instance | undefined {
    const byId = /^#(\d+)$/.exec(linkage);
    const id = byId
      ? Number(byId[1])
      : parent.movie.exports.find(
          (each) => each.name.toLowerCase() === linkage.toLowerCase(),
        )?.character;

    if (id === undefined) {
      this.options.log?.(`attachMovie: nothing is exported as "${linkage}"`);
      return undefined;
    }
    return this.place(
      parent,
      depth,
      this.create(parent.movie, id, `${parent.path}/${depth}`, parent, {
        matrix: [1, 0, 0, 1],
        translate: [0, 0],
        alpha: 1,
        born: parent.frame,
        name,
      }),
    );
  }

  public createEmpty(parent: Instance, name: string, depth: number): Instance {
    const instance = this.create(
      parent.movie,
      -1,
      `${parent.path}/${depth}`,
      parent,
      {
        matrix: [1, 0, 0, 1],
        translate: [0, 0],
        alpha: 1,
        born: parent.frame,
        name,
      },
    );

    instance.character = {
      type: "sprite",
      id: -1,
      offset: 0,
      frameCount: 0,
      framesOffset: 0,
    };
    instance.missing = undefined;
    return this.place(parent, depth, instance);
  }

  public remove(clip: Instance): void {
    const parent = clip.parent;

    if (!parent) {
      return;
    }
    for (const [key, child] of parent.children) {
      if (child === clip) {
        parent.children.delete(key);
      }
    }
    this.retire(clip);
  }

  /** Puts a script-made clip at a depth, in depth order with the rest */
  private place(parent: Instance, depth: number, instance: Instance): Instance {
    const old = parent.children.get(String(depth));

    if (old) {
      this.retire(old);
    }
    instance.dynamic = true;
    parent.children.set(String(depth), instance);
    parent.children = new Map(
      [...parent.children].sort(([a], [b]) => Number(a) - Number(b)),
    );
    return instance;
  }

  /** Marks a clip gone, with what it holds, running its unload handler */
  private retire(instance: Instance): void {
    if (instance.removed) {
      return;
    }
    this.clipEvent(instance, CLIP_EVENT.unload);
    instance.removed = true;
    instance.children.forEach((child) => this.retire(child));
  }

  private scriptsRun(timeline: Instance): boolean {
    return timeline === this.root
      ? this.options.rootScripts
      : this.options.scripts;
  }

  /** Runs a clip's `onClipEvent` blocks for an event, on its parent's code */
  private clipEvent(instance: Instance, event: number): void {
    if (!this.vm || !instance.parent) {
      return;
    }
    const vm = this.vm;
    const parent = instance.parent;

    for (const action of instance.clipActions ?? []) {
      if (action.events & event) {
        this.later(() => vm.runBlock(instance, action.block, parent));
      }
    }
    this.idle();
  }

  /** Moves a timeline to a frame, running that frame's scripts */
  public goTo(timeline: Instance, frame: number, play: boolean): void {
    timeline.playing = play;
    if (
      frame !== timeline.frame &&
      frame >= 0 &&
      frame < timeline.frames.length
    ) {
      this.enter(timeline, frame);
    }
  }

  /** The frame a label names on a timeline, without casing */
  public labelFrame(timeline: Instance, label: string): number | undefined {
    const wanted = label.toLowerCase();
    const index = timeline.frames.findIndex((frame) =>
      frame.items.some(
        (item) =>
          item.type === "frameLabel" && item.label.toLowerCase() === wanted,
      ),
    );

    return index < 0 ? undefined : index;
  }

  /** Every frame label of a timeline, in frame order */
  public labels(timeline: Instance): { label: string; frame: number }[] {
    return timeline.frames.flatMap((frame, index) =>
      frame.items.flatMap((item) =>
        item.type === "frameLabel" ? [{ label: item.label, frame: index }] : [],
      ),
    );
  }

  /** Shows a button in a state, or lets the pointer decide again */
  public force(button: Instance, state: number | undefined): void {
    button.forced = state;
    this.syncButton(button);
  }

  /** The pointer moved onto a button, or off every button */
  public hover(
    previous: Instance | undefined,
    next: Instance | undefined,
  ): void {
    if (previous === next) {
      return;
    }
    if (previous && this.attached(previous)) {
      this.buttonEvent(previous, CONDITION.rollOut, UP);
    }
    if (next) {
      this.buttonEvent(next, CONDITION.rollOver, OVER);
    }
  }

  public press(button: Instance): void {
    this.buttonEvent(button, CONDITION.press, DOWN);
  }

  /** The pointer was let go: over the button pressed, or elsewhere */
  public release(button: Instance, over: boolean): void {
    this.buttonEvent(
      button,
      over ? CONDITION.release : CONDITION.releaseOutside,
      over ? OVER : UP,
    );
  }

  /** Every instance, root first, depth first */
  public all(): Instance[] {
    const out: Instance[] = [];
    const visit = (instance: Instance) => {
      out.push(instance);
      instance.children.forEach(visit);
    };

    visit(this.root);
    return out;
  }

  public find(path: string): Instance | undefined {
    return this.all().find((instance) => instance.path === path);
  }

  private attached(instance: Instance): boolean {
    for (let at: Instance | undefined = instance; at; at = at.parent) {
      if (at === this.root) {
        return true;
      }
      if (
        at.parent &&
        ![...at.parent.children.values(), ...at.parent.hits].includes(at)
      ) {
        return false;
      }
    }
    return false;
  }

  private create(
    from: PageMovie,
    id: number,
    path: string,
    parent: Instance | undefined,
    place: Pick<
      Instance,
      "matrix" | "translate" | "alpha" | "born" | "clipDepth" | "clipActions"
    > & {
      name?: string;
      placedItem?: number;
      matrixItem?: number;
    },
  ): Instance {
    const found = this.options.resolve(from, id);
    const entry = found
      ? undefined
      : from.imports.find((each) => each.character === id);
    const instance: Instance = {
      path,
      clipActions: place.clipActions,
      movie: found?.movie ?? from,
      id: found?.id ?? id,
      character: found?.character,
      missing: found
        ? undefined
        : entry
          ? `${entry.movie}:${entry.name}`
          : "import",
      parent,
      name: place.name,
      matrix: place.matrix,
      translate: place.translate,
      alpha: place.alpha,
      clipDepth: place.clipDepth,
      born: place.born,
      placed: id,
      placedItem: place.placedItem,
      matrixItem: place.matrixItem,
      frames: found ? framesOf(found.movie, found.character) : [],
      frame: 0,
      playing: true,
      children: new Map(),
      hits: [],
      buttonState: UP,
      created: this.ticks,
    };
    const depth = path.split("/").length;

    if (depth > MAX_DEPTH) {
      return instance;
    }
    if (isTimeline(instance)) {
      this.enter(instance, 0);
    } else if (instance.character?.type === "button") {
      this.syncButton(instance);
    }
    if (parent && this.vm && this.scriptsRun(parent)) {
      this.clipEvent(
        instance,
        CLIP_EVENT.initialize | CLIP_EVENT.construct | CLIP_EVENT.load,
      );
    }
    return instance;
  }

  /** Shows a frame: brings the children in line with it, then runs its scripts */
  private enter(timeline: Instance, frame: number): void {
    timeline.frame = frame;
    this.syncTimeline(timeline);

    if (!this.scriptsRun(timeline)) {
      return;
    }

    const items = timeline.frames[frame]?.items ?? [];
    const vm = this.vm;

    if (vm) {
      // A sprite's init actions run once, before any frame script
      for (const item of items) {
        const key = `${timeline.movie.name}#${item.type === "initAction" ? item.sprite : ""}`;

        if (item.type === "initAction" && !vm.initialised.has(key)) {
          vm.initialised.add(key);
          this.later(() => vm.runBlock(timeline, item.block));
        }
      }
      for (const item of items) {
        if (item.type === "action") {
          // A frame left before its turn came does not run its script
          this.later(() => {
            if (timeline.frame === frame && !timeline.removed) {
              vm.runBlock(timeline, item.block);
            }
          });
        }
      }
      this.idle();
      return;
    }
    for (const item of items) {
      if (item.type === "action") {
        this.run(timeline, timeline.movie.behaviours[item.block], "frame");
      }
    }
  }

  /** Keeps a child that is the same instance, places new ones, drops the rest */
  private syncTimeline(timeline: Instance): void {
    const kept = new Map<string, Instance>();

    for (const placement of displayList(timeline.frames, timeline.frame)) {
      const key = String(placement.depth);
      const existing = timeline.children.get(key);
      if (
        existing &&
        !existing.dynamic &&
        existing.born === placement.born &&
        existing.placed === placement.character
      ) {
        Object.assign(
          existing,
          existing.scripted
            ? {}
            : {
                matrix: placement.matrix,
                translate: placement.translate,
                alpha: placement.alpha,
              },
          {
            clipDepth: placement.clipDepth,
            name: existing.scripted ? existing.name : placement.name,
            matrixItem: placement.matrixItem,
          },
        );
        kept.set(key, existing);
      } else {
        kept.set(
          key,
          this.create(
            timeline.movie,
            placement.character,
            `${timeline.path}/${placement.depth}`,
            timeline,
            placement,
          ),
        );
      }
    }
    // What scripts made stays until a script removes it
    for (const [key, child] of timeline.children) {
      if (child.dynamic && !kept.has(key)) {
        kept.set(key, child);
      } else if (kept.get(key) !== child) {
        this.retire(child);
      }
    }
    timeline.children = new Map(
      [...kept].sort(([a], [b]) => Number(a) - Number(b)),
    );
  }

  /** Shows the records of a button's state, keeping those still shown */
  private syncButton(button: Instance): void {
    if (button.character?.type !== "button") {
      return;
    }

    const state = button.forced ?? button.buttonState;
    const kept = new Map<string, Instance>();
    const place = (record: ButtonRecord) =>
      this.create(
        button.movie,
        record.character,
        `${button.path}/b${record.depth}`,
        button,
        {
          matrix: record.matrix,
          translate: record.translate,
          alpha: 1,
          born: 0,
        },
      );

    for (const record of button.character.records) {
      if (record.flags & state) {
        const key = `b${record.depth}`;

        kept.set(key, button.children.get(key) ?? place(record));
      }
    }
    button.children = kept;
    if (!button.hits.length) {
      button.hits = button.character.records
        .filter((record) => record.flags & HIT)
        .map(place);
    }
  }

  private buttonEvent(
    button: Instance,
    condition: number,
    state: number,
  ): void {
    if (button.character?.type !== "button") {
      return;
    }

    button.buttonState = state;
    this.syncButton(button);

    // A button's actions run on the timeline it is placed in
    const owner = button.parent ?? this.root;
    const name =
      Object.entries(CONDITION).find(([, bit]) => bit === condition)?.[0] ??
      "event";

    const vm = this.vm;

    for (const action of button.character.actions) {
      if (action.condition & condition) {
        if (vm) {
          this.options.log?.(`${name} on ${describe(button)}`);
          vm.runBlock(owner, action.block, button);
        } else {
          this.run(
            owner,
            button.movie.behaviours[action.block],
            `${name} on ${describe(button)}`,
          );
        }
      }
    }

    // A handler a script gave the button (`btn.onRelease = function () {}`)
    const handler = vm && HANDLERS[condition];

    if (vm && handler) {
      const self = vm.objectOf(button);
      const fn = vm.member(self, handler);

      if (fn !== undefined) {
        vm.callFromEngine(fn, self, []);
      }
    }
  }

  /** A text field's text: set by a script, else its bound variable's value */
  public textOf(instance: Instance): string | undefined {
    if (instance.text !== undefined) {
      return instance.text;
    }

    const character = instance.character;

    if (
      !this.vm ||
      character?.type !== "editText" ||
      !character.variable ||
      !instance.parent
    ) {
      return undefined;
    }

    const value = this.vm.readBound(instance.parent, character.variable);

    return value === undefined ? undefined : this.vm.string(value);
  }

  /** Runs what a block does to timelines, from the timeline it runs on */
  private run(
    self: Instance,
    behaviour: Behaviour | undefined,
    why: string,
  ): void {
    if (!behaviour || this.chain >= MAX_CHAIN) {
      return;
    }

    this.chain++;
    try {
      const done: string[] = [];

      for (const command of behaviour.commands) {
        const target = this.target(self, command.target);

        if (target) {
          this.apply(target, command);
          done.push(describeCommand(command));
        } else {
          done.push(
            `${describeCommand(command)} (no ${command.target.join(".")})`,
          );
        }
      }
      // Frame scripts run every time a frame is entered; only events are worth a line
      if (why !== "frame") {
        this.options.log?.(
          `${why}: ${done.join(", ") || "nothing to run"}` +
            (behaviour.skipped
              ? ` · ${behaviour.skipped} statement${behaviour.skipped === 1 ? "" : "s"} not run${behaviour.conditional ? " (conditional)" : ""}`
              : ""),
        );
      }
    } finally {
      this.chain--;
    }
  }

  private apply(target: Instance, command: TimelineCommand): void {
    switch (command.op) {
      case "goto": {
        const frame =
          command.label !== undefined
            ? this.labelFrame(target, command.label)
            : command.frame;

        if (frame !== undefined) {
          this.goTo(target, frame, command.play);
        }
        break;
      }
      case "play":
        target.playing = true;
        break;
      case "stop":
        target.playing = false;
        break;
      case "next":
      case "prev":
        this.goTo(
          target,
          target.frame + (command.op === "next" ? 1 : -1),
          false,
        );
        break;
    }
  }

  /** The timeline a command path names, from the one the block runs on */
  private target(self: Instance, path: string[]): Instance | undefined {
    let at: Instance | undefined = self;

    for (const part of path) {
      const lower = part.toLowerCase();

      if (lower === "_parent") {
        at = at?.parent;
        // A button is not a timeline; its parent's parent is
        while (at && !isTimeline(at)) {
          at = at.parent;
        }
      } else if (lower === "_root") {
        at = this.root;
      } else if (lower !== "this") {
        at =
          at &&
          [...at.children.values()].find(
            (child) => child.name?.toLowerCase() === lower,
          );
      }
    }
    return at && isTimeline(at) ? at : undefined;
  }
}

export const describe = (instance: Instance): string =>
  (instance.name ? `"${instance.name}" ` : "") +
  `#${instance.id}${instance.path ? " @" + instance.path : ""}`;

const describeCommand = (command: TimelineCommand): string => {
  const on = command.target.length ? ` on ${command.target.join(".")}` : "";

  if (command.op !== "goto") {
    return command.op + on;
  }

  const where =
    command.label !== undefined
      ? `"${command.label}"`
      : `frame ${command.frame}`;

  return `${command.play ? "gotoAndPlay" : "gotoAndStop"} ${where}${on}`;
};
