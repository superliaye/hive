import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

/**
 * Vite plugin to prefer .ts source files over stale .js build artifacts
 * in the src/ directory. When both parser.ts and parser.js exist in src/,
 * this ensures the .ts file is loaded.
 */
function preferTsOverJs() {
  return {
    name: 'prefer-ts-over-js',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.endsWith('.js')) return null;
      if (!source.startsWith('.')) return null;
      const jsPath = path.resolve(path.dirname(importer), source);
      const tsPath = jsPath.replace(/\.js$/, '.ts');
      if (fs.existsSync(tsPath) && fs.existsSync(jsPath)) {
        return tsPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [preferTsOverJs()],
  test: {
    globals: false,
    testTimeout: 10_000,
  },
});
