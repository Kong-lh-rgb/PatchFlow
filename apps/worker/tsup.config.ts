import { defineConfig } from 'tsup';

/**
 * 打包为可直接 node 运行的 ESM 产物；
 * workspace 内部包为 TS 源码发布，必须打进 bundle（同 apps/api）。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@patchflow\//],
});
