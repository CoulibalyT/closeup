import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    include: ['src/**/*.test.ts'],
    // The "dependency is down" tests wait for real connection timeouts.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
  plugins: [
    // esbuild cannot emit decorator metadata, which Nest's dependency injection relies on.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
