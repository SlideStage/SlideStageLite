import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/tokens.ts',
    'src/assets/index.ts',
    'src/assets/lite.ts',
    'src/assets/pro.ts',
    'src/assets/pack.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  target: 'es2022',
  outDir: 'dist',
});
