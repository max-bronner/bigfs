import type {
  Behaviour,
  TimelineCommand,
} from '../../formats/apt/aptBehaviour';
import type {
  ButtonRecord,
  Character,
  Frame,
  Matrix2,
} from '../../formats/apt/aptMovie';
import type { PageMovie } from './protocol';
import { displayList, framesOf } from './timeline';

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
  /** The frame its parent placed it in, which tells a move from a new instance */
  born: number;
  /** The character id it was placed with, before any import resolved it */
  placed: number;
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
}

const isTimeline = (instance: Instance) =>
  instance.character?.type === 'sprite' || instance.character?.type === 'movie';

export class Player {
  public readonly root: Instance;
  public ticks = 0;
  private chain = 0;

  public constructor(
    movie: PageMovie,
    id: number,
    private readonly options: PlayerOptions,
  ) {
    this.root = this.create(movie, id, '', undefined, {
      matrix: [1, 0, 0, 1],
      translate: [0, 0],
      alpha: 1,
      born: 0,
    });
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
          item.type === 'frameLabel' && item.label.toLowerCase() === wanted,
      ),
    );

    return index < 0 ? undefined : index;
  }

  /** Every frame label of a timeline, in frame order */
  public labels(timeline: Instance): { label: string; frame: number }[] {
    return timeline.frames.flatMap((frame, index) =>
      frame.items.flatMap((item) =>
        item.type === 'frameLabel' ? [{ label: item.label, frame: index }] : [],
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
    place: Pick<Instance, 'matrix' | 'translate' | 'alpha' | 'born'> & {
      name?: string;
    },
  ): Instance {
    const found = this.options.resolve(from, id);
    const entry = found
      ? undefined
      : from.imports.find((each) => each.character === id);
    const instance: Instance = {
      path,
      movie: found?.movie ?? from,
      id: found?.id ?? id,
      character: found?.character,
      missing: found
        ? undefined
        : entry
          ? `${entry.movie}:${entry.name}`
          : 'import',
      parent,
      name: place.name,
      matrix: place.matrix,
      translate: place.translate,
      alpha: place.alpha,
      born: place.born,
      placed: id,
      frames: found ? framesOf(found.movie, found.character) : [],
      frame: 0,
      playing: true,
      children: new Map(),
      hits: [],
      buttonState: UP,
      created: this.ticks,
    };
    const depth = path.split('/').length;

    if (depth > MAX_DEPTH) {
      return instance;
    }
    if (isTimeline(instance)) {
      this.enter(instance, 0);
    } else if (instance.character?.type === 'button') {
      this.syncButton(instance);
    }
    return instance;
  }

  /** Shows a frame: brings the children in line with it, then runs its scripts */
  private enter(timeline: Instance, frame: number): void {
    timeline.frame = frame;
    this.syncTimeline(timeline);

    const runs =
      timeline === this.root ? this.options.rootScripts : this.options.scripts;

    if (!runs) {
      return;
    }
    for (const item of timeline.frames[frame]?.items ?? []) {
      if (item.type === 'action') {
        this.run(timeline, timeline.movie.behaviours[item.block], 'frame');
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
        existing.born === placement.born &&
        existing.placed === placement.character
      ) {
        Object.assign(existing, {
          matrix: placement.matrix,
          translate: placement.translate,
          alpha: placement.alpha,
          name: placement.name,
        });
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
    timeline.children = kept;
  }

  /** Shows the records of a button's state, keeping those still shown */
  private syncButton(button: Instance): void {
    if (button.character?.type !== 'button') {
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
    if (button.character?.type !== 'button') {
      return;
    }

    button.buttonState = state;
    this.syncButton(button);

    // A button's actions run on the timeline it is placed in
    const owner = button.parent ?? this.root;
    const name =
      Object.entries(CONDITION).find(([, bit]) => bit === condition)?.[0] ??
      'event';

    for (const action of button.character.actions) {
      if (action.condition & condition) {
        this.run(
          owner,
          button.movie.behaviours[action.block],
          `${name} on ${describe(button)}`,
        );
      }
    }
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
            `${describeCommand(command)} (no ${command.target.join('.')})`,
          );
        }
      }
      // Frame scripts run every time a frame is entered; only events are worth a line
      if (why !== 'frame') {
        this.options.log?.(
          `${why}: ${done.join(', ') || 'nothing to run'}` +
            (behaviour.skipped
              ? ` · ${behaviour.skipped} statement${behaviour.skipped === 1 ? '' : 's'} not run${behaviour.conditional ? ' (conditional)' : ''}`
              : ''),
        );
      }
    } finally {
      this.chain--;
    }
  }

  private apply(target: Instance, command: TimelineCommand): void {
    switch (command.op) {
      case 'goto': {
        const frame =
          command.label !== undefined
            ? this.labelFrame(target, command.label)
            : command.frame;

        if (frame !== undefined) {
          this.goTo(target, frame, command.play);
        }
        break;
      }
      case 'play':
        target.playing = true;
        break;
      case 'stop':
        target.playing = false;
        break;
      case 'next':
      case 'prev':
        this.goTo(
          target,
          target.frame + (command.op === 'next' ? 1 : -1),
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

      if (lower === '_parent') {
        at = at?.parent;
        // A button is not a timeline; its parent's parent is
        while (at && !isTimeline(at)) {
          at = at.parent;
        }
      } else if (lower === '_root') {
        at = this.root;
      } else if (lower !== 'this') {
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
  (instance.name ? `"${instance.name}" ` : '') +
  `#${instance.id}${instance.path ? ' @' + instance.path : ''}`;

const describeCommand = (command: TimelineCommand): string => {
  const on = command.target.length ? ` on ${command.target.join('.')}` : '';

  if (command.op !== 'goto') {
    return command.op + on;
  }

  const where =
    command.label !== undefined
      ? `"${command.label}"`
      : `frame ${command.frame}`;

  return `${command.play ? 'gotoAndPlay' : 'gotoAndStop'} ${where}${on}`;
};
