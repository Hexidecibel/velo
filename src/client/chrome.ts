// Two bits of always-visible chrome that are navigation, not tuning: the level
// picker and the control legend. They live outside the panel on purpose —
// pressing H to hide the sliders should not also hide how you change level or
// what the keys are.
import type { LevelEntry } from './levels.ts';
import { ticksToSeconds } from '@/sim/replay.ts';
import { loadFlag, saveFlag } from './store.ts';

export interface LevelBar {
  /** Re-render: selection, and the best-time annotations. */
  update(currentId: string, bests: Record<string, number>): void;
}

export function createLevelBar(
  root: HTMLElement,
  levels: LevelEntry[],
  onPick: (id: string) => void,
): LevelBar {
  root.textContent = '';
  const label = document.createElement('span');
  label.className = 'lb-label';
  label.textContent = 'level';
  const select = document.createElement('select');
  select.id = 'levelselect';
  root.append(label, select);

  const note = document.createElement('span');
  note.className = 'lb-note';
  root.append(note);

  select.addEventListener('change', () => onPick(select.value));

  return {
    update(currentId: string, bests: Record<string, number>): void {
      // Rebuilt rather than patched, because the level list can grow under us
      // while somebody is authoring files into levels/ with the dev server up.
      select.textContent = '';
      for (const l of levels) {
        const o = document.createElement('option');
        o.value = l.id;
        // A level that will not load still appears, and says so. A level
        // silently missing from the menu is the most confusing possible
        // feedback for somebody halfway through authoring it.
        if (!l.level) {
          o.textContent = `${l.label}  — BROKEN`;
        } else {
          const best = bests[l.level.simHash];
          o.textContent = best === undefined
            ? l.label
            : `${l.label}  ✓ ${ticksToSeconds(best).toFixed(2)}s`;
        }
        select.append(o);
      }
      select.value = currentId;
      const cur = levels.find((l) => l.id === currentId);
      const done = levels.filter((l) => l.level && bests[l.level.simHash] !== undefined).length;
      note.textContent = cur?.error
        ? `does not load: ${cur.error}`
        : `${done}/${levels.length} completed (local, this browser, rev-scoped)`;
      note.className = cur?.error ? 'lb-note bad' : 'lb-note';
    },
  };
}

/**
 * The legend. It exists for one reason: SPACE FLIPS DIRECTION, that is the
 * mechanic the whole double-back level design rests on, and until now there was
 * nothing on screen that said so. Collapsible, remembered, and small.
 */
export function createLegend(root: HTMLElement): void {
  root.textContent = '';
  const open = loadFlag('legend', true);
  const d = document.createElement('details');
  d.open = open;
  const s = document.createElement('summary');
  s.textContent = 'controls';
  d.append(s);
  const body = document.createElement('div');
  body.innerHTML =
    '<b>&#8593; / W</b> gas &nbsp; <b>&#8595; / S</b> brake<br>' +
    '<b>&#8592; &#8594; / A D</b> rotate the bike<br>' +
    '<b>SPACE</b> flip direction — this is how you double back<br>' +
    '<b>TAB</b> hold to see the whole level (time stops)<br>' +
    '<b>R</b> restart &nbsp; <b>T</b> replay &nbsp; <b>E</b> export replay<br>' +
    '<b>[ / ]</b> level &nbsp; <b>+ / -</b> zoom &nbsp; <b>H</b> tuning sliders<br>' +
    '<b>G</b> show the true collision edge &nbsp; <b>V</b> art on / off';
  d.append(body);
  d.addEventListener('toggle', () => saveFlag('legend', d.open));
  root.append(d);
}
