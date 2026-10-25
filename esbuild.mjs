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

async function main() {
  const context = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.mjs',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });

  // The particle simulation runs inside the preview webview
  const webview = await esbuild.context({
    entryPoints: ['src/formats/particles/particleSimulation.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'BigfsParticles',
    minify: production,
    sourcemap: false,
    platform: 'browser',
    outfile: 'dist/webview/particles.js',
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });

  for (const each of [context, webview]) {
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
