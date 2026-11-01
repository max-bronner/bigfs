import type { Player } from './player';

/** One draw of the stage, as the engine surfaces in it see it */
export interface SurfacePass {
  player: Player;
  /** Counts the stage's draws, so a surface can tell a new one */
  pass: number;
  /** Whether the movie is playing; a still stage shows surfaces at rest */
  isPlaying: boolean;
}
