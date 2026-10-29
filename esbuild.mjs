import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Builds running across both bundles; the watch task waits for zero
let running = 0;

/**
 * Reports build results in the shape the watch task's problem matcher
 * expects. "Finished" is printed only when every bundle is done, or the
 * launch would start before the extension bundle is written.
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      if (running++ === 0) {
        console.log('[watch] build started');
      }
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`[ERROR] ${text}`);

        if (location) {
          console.error(
            `    ${location.file}:${location.line}:${location.column}:`,
          );
        }
      });
      if (--running === 0) {
        console.log('[watch] build finished');
      }
    });
  },
};

/**
 * The webview pages, each bundled for the browser into `dist/webview/<name>.js`.
 * The extension loads them by that name, so a name never changes.
 */
const PAGES = [
  // The particle preview's page, with the simulation it runs
  { name: 'particles', entry: 'src/webview/particles/main.ts' },
  // The APT editor's page
  { name: 'apt', entry: 'src/webview/apt/main.ts' },
  // The armor table's page
  { name: 'armor', entry: 'src/webview/armor/main.ts' },
  // The CommandSet editor's page
  { name: 'commandset', entry: 'src/webview/commandset/main.ts' },
  // The W3D viewer's model view
  { name: 'model', entry: 'src/webview/model/main.ts' },
  // The map editor's page
  { name: 'map', entry: 'src/webview/map/main.ts' },
  // The Create-a-Hero editor's page
  { name: 'cah', entry: 'src/webview/cah/main.ts' },
  // The string table editor's page
  { name: 'strings', entry: 'src/webview/strings/main.ts' },
  // The map script viewer's page
  { name: 'scripts', entry: 'src/webview/scripts/main.ts' },
];

/** Options every bundle shares */
const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'silent',
  plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
  const contexts = await Promise.all([
    esbuild.context({
      ...shared,
      entryPoints: ['src/extension.ts'],
      format: 'esm',
      platform: 'node',
      outfile: 'dist/extension.mjs',
      external: ['vscode'],
    }),
    ...PAGES.map(({ name, entry }) =>
      esbuild.context({
        ...shared,
        entryPoints: [entry],
        format: 'iife',
        platform: 'browser',
        outfile: `dist/webview/${name}.js`,
      }),
    ),
  ]);

  for (const each of contexts) {
    if (watch) {
      await each.watch();
    } else {
      await each.rebuild();
      await each.dispose();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
