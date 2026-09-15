// Getting a replay out of the browser and back in again.
//
// This is the point of the determinism work earning its keep. A player saying
// "sometimes it gets weird" cannot be acted on; a player handing over a file
// can, because the sim takes no wall-clock input and the same input stream
// produces the same run on any machine, forever, at a fixed SIM_REV.
//
// So: E exports the last run as a self-contained JSON file carrying the level,
// the bike and the hash chain. Drag it back onto the window — or onto
// `bin/replay` — and the exact moment runs again.
import { parseReplayFile, replayFileName, toReplayFile } from '@/sim/replay.ts';
import type { Replay, ReplayFile } from '@/sim/replay.ts';
import type { BikeSpec } from '@/sim/spec.ts';

/** Filesystem-safe local timestamp. Presentation only; never reaches the sim. */
function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface ExportContext {
  /** The level's RAW json, not the compiled one — the file must stand alone. */
  levelRaw: unknown;
  levelName: string;
  spec: BikeSpec;
  note?: string;
}

export function buildExport(replay: Replay, ctx: ExportContext): ReplayFile {
  return toReplayFile(replay, {
    level: ctx.levelRaw,
    levelName: ctx.levelName,
    spec: ctx.spec,
    recordedAt: new Date().toISOString(),
    note: ctx.note,
  });
}

/** Hand the file to the browser's downloader. Returns the filename used. */
export function downloadReplay(replay: Replay, ctx: ExportContext): string {
  const file = buildExport(replay, ctx);
  const name = replayFileName(file, stamp());
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately races the download in some browsers; a tick is plenty.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** Open the OS file picker and parse what comes back. */
export function pickReplay(): Promise<{ file: ReplayFile; name: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) {
        resolve(null);
        return;
      }
      readReplayFile(f).then((r) => resolve(r), reject);
    });
    // No 'cancel' event in every browser, so a cancelled picker simply leaves
    // the promise pending and the element removed on the next pick. Harmless.
    input.click();
  });
}

export async function readReplayFile(f: File): Promise<{ file: ReplayFile; name: string }> {
  const text = await f.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`${f.name} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { file: parseReplayFile(json), name: f.name };
}

/**
 * Accept a replay dropped anywhere on the window. Drag-and-drop matters more
 * than it looks: the fastest possible loop for "send me the file" is the user
 * dragging it straight out of their downloads folder onto the game.
 */
export function onReplayDropped(
  target: HTMLElement | Window,
  handler: (r: { file: ReplayFile; name: string }) => void,
  onError: (msg: string) => void,
): void {
  const stop = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  target.addEventListener('dragover', stop as EventListener);
  target.addEventListener('drop', ((e: DragEvent) => {
    stop(e);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    readReplayFile(f).then(handler, (err: unknown) => onError(err instanceof Error ? err.message : String(err)));
  }) as EventListener);
}
