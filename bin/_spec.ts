// bin/spec — change the bike from a terminal while somebody else rides it.
//
// See bin/spec for usage. The ergonomics here matter more than the endpoint's:
// this is the thing a person types, repeatedly, mid-conversation, while
// watching somebody play. So:
//
//   * every command prints what the bike will now be, not just "ok";
//   * a set prints the BEFORE and AFTER value, because "gravity 9.2" alone does
//     not tell you whether you moved it far;
//   * an unknown path is refused with the nearest real ones listed, rather than
//     written to a file that silently does nothing;
//   * `--paths` dumps every addressable field, because guessing at the shape of
//     a nested spec from memory is exactly the friction this is meant to remove.
import { readFileSync } from 'node:fs';
import { BOOT_PRESET, PRESETS } from '../src/client/presets.ts';
import { applySpecOverride, diffSpec, getSpecPath, specHash, specPaths } from '../src/sim/spec.ts';
import type { BikeSpec } from '../src/sim/spec.ts';
import { SPEC_FILE, clearSpecFile, readSpecFile, writeSpecFile } from '../src/server/specfile.ts';

function die(msg: string): never {
  console.error(`bin/spec: ${msg}`);
  process.exit(2);
}

/** Cheap edit distance, for "did you mean". Good enough for a typo in a path. */
function near(path: string, all: string[]): string[] {
  const score = (a: string, b: string): number => {
    if (a === b) return 0;
    if (b.includes(a) || a.includes(b)) return 1;
    // Count shared leading characters; enough to surface a fumbled leaf name.
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return 100 - i;
  };
  return all
    .map((p) => ({ p, s: score(path.toLowerCase(), p.toLowerCase()) }))
    .sort((x, y) => x.s - y.s)
    .slice(0, 5)
    .filter((x) => x.s < 100)
    .map((x) => x.p);
}

function baseSpec(): BikeSpec {
  return BOOT_PRESET.spec;
}

/** The spec the client will actually be riding: the boot preset plus the file. */
function effective(): { spec: BikeSpec; applied: string[]; unknown: string[]; version: string; present: boolean; error: string | null } {
  const file = readSpecFile();
  const r = applySpecOverride(baseSpec(), file.override);
  return { ...r, version: file.version, present: file.present, error: file.error };
}

function printState(label: string): void {
  const e = effective();
  const changes = diffSpec(baseSpec(), e.spec);
  console.log(`==> ${label}`);
  console.log(`    file      ${SPEC_FILE}${e.present ? '' : '  (absent — no override)'}`);
  if (e.error) console.log(`    ERROR     ${e.error}`);
  console.log(`    base      ${BOOT_PRESET.label}`);
  console.log(`    specHash  ${specHash(e.spec)}   version ${e.version}`);
  if (e.unknown.length) {
    console.log(`    IGNORED   ${e.unknown.length} unknown path(s) in the file: ${e.unknown.join(', ')}`);
  }
  if (changes.length === 0) {
    console.log('    overrides none — the bike is the preset as shipped');
    return;
  }
  console.log(`    overrides ${changes.length}`);
  const w = Math.max(...changes.map((c) => c.path.length));
  for (const c of changes) {
    console.log(`      ${c.path.padEnd(w)}  ${fmt(c.from)} -> ${fmt(c.to)}`);
  }
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(10)));
}

/** A nested partial object from a flat path -> value map. */
function nest(flat: Map<string, number>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of flat) {
    const segs = path.split('.');
    let node = out;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    node[segs[segs.length - 1]] = value;
  }
  return out;
}

/** The override file as a flat map, dropping anything that is not a real field. */
function flatten(): Map<string, number> {
  const file = readSpecFile();
  const { spec } = applySpecOverride(baseSpec(), file.override);
  const out = new Map<string, number>();
  const applied = applySpecOverride(baseSpec(), file.override).applied;
  for (const p of applied) {
    const v = getSpecPath(spec, p);
    if (v !== undefined) out.set(p, v);
  }
  return out;
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'show';

if (cmd === '--paths' || cmd === 'paths') {
  const all = specPaths();
  const base = baseSpec();
  console.log(`==> ${all.length} addressable fields, with their value on "${BOOT_PRESET.label}"`);
  const w = Math.max(...all.map((p) => p.length));
  for (const p of all) console.log(`    ${p.padEnd(w)}  ${fmt(getSpecPath(base, p) ?? NaN)}`);
  process.exit(0);
}

if (cmd === 'show') {
  printState('current effective spec');
  process.exit(0);
}

if (cmd === 'set') {
  const path = argv[1];
  const valueStr = argv[2];
  if (!path || valueStr === undefined) die('usage: bin/spec set <path> <value>');
  const value = Number(valueStr);
  if (!Number.isFinite(value)) die(`"${valueStr}" is not a finite number`);
  const all = specPaths();
  if (!all.includes(path)) {
    const suggestions = near(path, all);
    die(
      `"${path}" is not a field on BikeSpec.` +
        (suggestions.length ? `\n    did you mean: ${suggestions.join(', ')}` : '') +
        '\n    bin/spec --paths lists every field.',
    );
  }
  const before = getSpecPath(effective().spec, path);
  const flat = flatten();
  flat.set(path, value);
  writeSpecFile(nest(flat));
  console.log(`==> ${path}  ${fmt(before ?? NaN)} -> ${fmt(value)}`);
  printState('now riding');
  process.exit(0);
}

if (cmd === 'unset') {
  const path = argv[1];
  if (!path) die('usage: bin/spec unset <path>');
  const flat = flatten();
  if (!flat.has(path)) die(`"${path}" is not currently overridden. bin/spec show lists what is.`);
  const before = flat.get(path);
  flat.delete(path);
  if (flat.size === 0) clearSpecFile();
  else writeSpecFile(nest(flat));
  const after = getSpecPath(effective().spec, path);
  console.log(`==> ${path}  ${fmt(before ?? NaN)} -> ${fmt(after ?? NaN)}  (back to the preset)`);
  printState('now riding');
  process.exit(0);
}

if (cmd === 'reset') {
  clearSpecFile();
  printState('all overrides cleared');
  process.exit(0);
}

if (cmd === 'load') {
  const file = argv[1];
  if (!file) die('usage: bin/spec load <file.json>');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    die(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const probe = applySpecOverride(baseSpec(), raw);
  if (probe.applied.length === 0) {
    die(`${file} set no BikeSpec fields at all. Is it a spec? bin/spec --paths lists the field names.`);
  }
  if (probe.unknown.length) {
    console.log(`    note: ${probe.unknown.length} key(s) in ${file} are not BikeSpec fields and were dropped:`);
    console.log(`          ${probe.unknown.join(', ')}`);
  }
  // Store only the fields that DIFFER from the preset. A whole spec pasted in
  // would otherwise pin all 42 fields, and every later `bin/spec unset` would
  // fall back to a pinned value rather than to the preset — which is not what
  // "unset" means to anybody.
  const flat = new Map<string, number>();
  for (const c of diffSpec(baseSpec(), probe.spec)) flat.set(c.path, c.to);
  if (flat.size === 0) clearSpecFile();
  else writeSpecFile(nest(flat));
  printState(`loaded ${file}`);
  process.exit(0);
}

if (cmd === 'preset') {
  const id = argv[1];
  const p = PRESETS.find((x) => x.id === id);
  if (!p) {
    die(`unknown preset "${id ?? ''}". Available: ${PRESETS.map((x) => x.id).join(', ')}`);
  }
  const flat = new Map<string, number>();
  for (const c of diffSpec(baseSpec(), p.spec)) flat.set(c.path, c.to);
  if (flat.size === 0) clearSpecFile();
  else writeSpecFile(nest(flat));
  printState(`loaded preset "${p.label}"`);
  process.exit(0);
}

die(`unknown command "${cmd}". Try: show, set, unset, reset, load, preset, --paths`);
