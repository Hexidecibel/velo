// =============================================================================
// velo — write .br / .gz siblings next to the built client assets
// =============================================================================
//   node_modules/.bin/tsx src/server/precompress.ts [distDir]
//
// Run by bin/deploy after bin/build. It is a DEPLOY step, not a build step,
// because bin/build belongs to the client/sim workstream and this concerns only
// what the production process serves — `bin/dev` and `bin/preview` neither
// produce nor need these files.
//
// WHY AT ALL: the server sets `precompressed: true`, which makes serveStatic
// prefer a `.br`/`.gz` sibling when the request allows it. HAProxy does not
// compress this backend, so without these the bundle and its source map go out
// raw. Missing siblings are not an error — serveStatic just falls through to
// the original file — so this is allowed to skip anything it cannot compress.
//
// Only text-shaped assets are worth it. Re-compressing a PNG or a woff2 costs
// CPU on every deploy and disk forever to save nothing, so the extension list
// is an allowlist rather than "everything in dist/".
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, createGzip, constants } from 'node:zlib';

const COMPRESSIBLE = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.wasm',
]);

// Below about a kilobyte the compressed copy is routinely BIGGER than the
// original (both formats carry a header, and a short file has no redundancy to
// find), and a sibling that is bigger than the file it shadows is a pessimism
// the server would then faithfully serve.
const MIN_BYTES = 1024;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function compress(file: string, kind: 'br' | 'gz'): Promise<number> {
  const out = `${file}.${kind}`;
  const codec =
    kind === 'br'
      ? createBrotliCompress({
          params: {
            [constants.BROTLI_PARAM_QUALITY]: 11,
            // Telling brotli the input size lets it size its window properly.
            [constants.BROTLI_PARAM_SIZE_HINT]: (await stat(file)).size,
          },
        })
      : createGzip({ level: 9 });
  await pipeline(createReadStream(file), codec, createWriteStream(out));
  const { size } = await stat(out);
  return size;
}

const dist = resolve(process.argv[2] ?? 'dist');

let written = 0;
let skipped = 0;
for await (const file of walk(dist)) {
  const ext = extname(file);
  // Never compress a compressed sibling — a second pass over a dist/ that was
  // already processed would otherwise produce index.js.br.br.
  if (ext === '.br' || ext === '.gz') continue;
  if (!COMPRESSIBLE.has(ext)) { skipped++; continue; }
  const { size } = await stat(file);
  if (size < MIN_BYTES) { skipped++; continue; }

  for (const kind of ['br', 'gz'] as const) {
    const outSize = await compress(file, kind);
    // If it did not actually get smaller, remove the sibling rather than leave
    // the server a worse option than the original.
    if (outSize >= size) {
      await unlink(`${file}.${kind}`);
      continue;
    }
    written++;
  }
  const rel = file.slice(dist.length + 1);
  console.log(`    ${rel} ${size}b`);
}

console.log(`==> precompressed ${written} sibling(s), skipped ${skipped} file(s)`);
