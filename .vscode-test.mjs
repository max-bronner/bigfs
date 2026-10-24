import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/suite/**/*.test.js',
	workspaceFolder: 'src/test/fixtures',
	// Software WebGL under xvfb, so the particle preview draws as well as runs
	launchArgs: ['--ignore-gpu-blocklist'],
});
