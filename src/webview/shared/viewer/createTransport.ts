import { element } from '../element';
import { advancePlayhead } from './advancePlayhead';

/** Seconds one press of Step moves: one step of the particle simulation */
const STEP_SECONDS = 1 / 30;
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];

/** What the transport asks of the viewer and tells it */
export interface TransportHooks {
  /** Seconds the slider spans; 0 when nothing sets a length */
  getLength(): number;
  /** Whether something is still running past that length */
  isBusy(): boolean;
  /** Whether anything on show moves with time */
  canPlay(): boolean;
  onAdvance(time: number): void;
  onSeek(time: number): void;
  onRestart(): void;
}

/** The viewer's one clock with its controls: play, stop, restart, step, speed, loop and the time slider */
export interface Transport {
  /** The bar's controls, in order */
  controls: HTMLElement[];
  /** Seconds the playhead stands at */
  getTime(): number;
  /** Seconds animated materials have run, which go on through a clip's loop */
  getMaterialSeconds(): number;
  isPlaying(): boolean;
  setPlaying(playing: boolean): void;
  togglePlaying(): void;
  /** Moves the playhead on by real seconds, at the chosen speed */
  advance(seconds: number): void;
  /** Stops playing and moves on by one step */
  step(): void;
  /** Goes back to the start and keeps playing or paused as it was */
  restart(): void;
  /** Brings the controls up to date with the clock */
  refresh(): void;
}

/** Creates the transport the viewer shows on every page */
export const createTransport = (hooks: TransportHooks): Transport => {
  const play = element('button', 'Pause');
  const stop = element('button', 'Stop');
  const restartButton = element('button', 'Restart');
  const stepButton = element('button', 'Step');
  const slider = element('input');
  const speedSelect = element('select');
  const loopLabel = element('label');
  const loopBox = element('input');
  const clock = { time: 0, materialSeconds: 0, playing: true, speed: 1 };

  play.title = 'Space';
  stop.title = 'Back to the start, paused';
  restartButton.title = 'R';
  stepButton.title = '.';
  slider.type = 'range';
  slider.min = '0';
  slider.step = 'any';
  slider.title = 'Time';
  speedSelect.title = 'Playback speed';
  speedSelect.append(...SPEEDS.map((speed) => new Option(`${speed}×`, String(speed))));
  speedSelect.value = '1';
  loopBox.type = 'checkbox';
  loopBox.checked = true;
  loopLabel.append(loopBox, ' Loop');

  const isPlaying = () => clock.playing && hooks.canPlay();

  const refresh = () => {
    const length = hooks.getLength();
    const canPlay = hooks.canPlay();

    play.textContent = isPlaying() ? 'Pause' : 'Play';
    play.disabled = stop.disabled = restartButton.disabled = stepButton.disabled = !canPlay;
    slider.disabled = !length;
    slider.max = String(Math.max(length, clock.time));
    slider.value = String(clock.time);
  };

  const setPlaying = (playing: boolean) => {
    clock.playing = playing;
    refresh();
  };

  const restart = () => {
    clock.time = 0;
    hooks.onRestart();
    refresh();
  };

  const togglePlaying = () => {
    const length = hooks.getLength();

    // Play at the end of a clip that does not loop starts it over
    if (!clock.playing && length && clock.time >= length && !hooks.isBusy()) {
      restart();
    }
    setPlaying(!clock.playing);
  };

  const advance = (seconds: number) => {
    const elapsed = seconds * clock.speed;
    const move = advancePlayhead(
      clock.time,
      elapsed,
      hooks.getLength(),
      hooks.isBusy(),
      loopBox.checked,
    );

    clock.materialSeconds += elapsed;
    clock.time = move.time;
    if (move.hasWrapped) {
      hooks.onRestart();
    } else {
      hooks.onAdvance(clock.time);
    }
    if (move.hasEnded) {
      clock.playing = false;
    }
    refresh();
  };

  play.onclick = togglePlaying;
  stop.onclick = () => {
    clock.playing = false;
    restart();
  };
  restartButton.onclick = restart;
  stepButton.onclick = () => {
    clock.playing = false;
    clock.time += STEP_SECONDS;
    clock.materialSeconds += STEP_SECONDS;
    hooks.onAdvance(clock.time);
    refresh();
  };
  speedSelect.onchange = () => {
    clock.speed = Number(speedSelect.value);
  };
  slider.oninput = () => {
    const time = Number(slider.value);

    clock.playing = false;
    // Scrubbing moves the materials by as much as it moves the clip
    clock.materialSeconds += time - clock.time;
    clock.time = time;
    hooks.onSeek(time);
    refresh();
  };

  return {
    controls: [play, stop, restartButton, stepButton, slider, speedSelect, loopLabel],
    getTime: () => clock.time,
    getMaterialSeconds: () => clock.materialSeconds,
    isPlaying,
    setPlaying,
    togglePlaying,
    advance,
    step: () => stepButton.click(),
    restart,
    refresh,
  };
};
