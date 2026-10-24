import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Reports build results in the shape the watch task's problem matcher expects
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
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
      console.log('[watch] build finished');
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
