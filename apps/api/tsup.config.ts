import { defineConfig } from 'tsup';

/**
 * 打包为可直接 node 运行的 ESM 产物。
 * workspace 内部包以 TS 源码发布（exports 指向 src），必须打进 bundle，
 * 否则 Node 运行时无法解析其中的 .js 导入说明符。
 */
export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@patchflow\//],
});
