import path from 'path';

/** Command line and working folder the game is started with for a mod folder */
export interface LaunchPlan {
  command: string;
  args: string[];
  /** The game finds its own files relative to where it starts */
  cwd: string;
}

/** Plans the process that runs a mod folder; `extra` goes before `-mod` */
export const planLaunch = (
  executable: string,
  modFolder: string | undefined,
  extra: readonly string[],
): LaunchPlan => ({
  command: executable,
  args: [...extra, ...(modFolder ? ['-mod', modFolder] : [])],
  cwd: path.dirname(executable),
});
