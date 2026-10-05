import { context } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = fileURLToPath(new URL('.demo/dev-server.mjs', root));
await mkdir(new URL('.demo/', root), { recursive: true });
const server = await context({
  entryPoints: [fileURLToPath(new URL('examples/server.mjs', root))],
  outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', sourcemap: true,
  plugins: [{ name: 'source-middleware', setup(builder) {
    builder.onResolve({ filter: /dist\/server\.js$/ }, () => ({ path: fileURLToPath(new URL('src/server.ts', root)) }));
  } }],
});
await server.rebuild();
await server.watch();
const child = spawn(process.execPath, ['--watch', output, '--dev'], { cwd: fileURLToPath(root), stdio: 'inherit' });
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.dispose();
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
child.on('exit', code => { void server.dispose().then(() => { process.exitCode = code ?? 0; }); });
