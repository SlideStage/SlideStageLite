import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/constants.ts',
    'src/types.ts',
    'src/pathSafety.ts',
    'src/trustCapabilities.ts',
    'src/manifestSchema.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  target: 'es2022',
  external: ['zod'],
  outDir: 'dist',
});
