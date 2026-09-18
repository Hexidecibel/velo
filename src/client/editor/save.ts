// FROM "EDITED IN THE BROWSER" TO "A FILE IN THE REPO", and an honest account
// of what each route can and cannot do.
//
// There are two, and the editor uses whichever is available without asking:
//
//   1. THE AUTHORING ENDPOINT. Present under `bin/dev` only (see
//      src/server/authoring.ts and the plugin in vite.config.ts). One keypress
//      writes `levels/<id>.json` and the dev server's glob picks it up. This is
//      the real path and it is the one the whole edit-and-ride loop is built
//      for: no dialog, no downloads folder, no copying anything anywhere.
//
//   2. DOWNLOAD, plus the file text on the clipboard. What is left when the
//      endpoint is not there — the deployed game at velo.cush.rocks, or the
//      editor reached over a tunnel from another machine. It works and it is
//      not pretending: the browser saves a file into the browser's downloads
//      folder and a human moves it. That is a step, and the entire value of
//      this editor is that there are no steps, so the panel says plainly which
//      of the two you are in rather than letting you find out.
//
// THERE IS NO THIRD ROUTE AND THERE IS NO PRETENDING. A browser cannot write to
// the repo, and a save button that looked like it had when it had not would
// cost somebody an afternoon of work.
import { ID_RE } from './check.ts';
import type { EditDoc } from './doc.ts';
import { docToFileText } from './doc.ts';

export interface AuthoringLevel {
  id: string;
  name: string;
  tier: string | null;
  /** True when the endpoint would refuse to write over it. */
  locked: boolean;
  simHash: string;
  error: string | null;
}

export interface AuthoringStatus {
  enabled: boolean;
  root: string;
  levels: AuthoringLevel[];
  /** Why it is off, when it is off. */
  note: string;
}

export const OFFLINE: AuthoringStatus = {
  enabled: false,
  root: '',
  levels: [],
  note: 'no authoring endpoint — this build cannot write to the repo. Saving downloads the file instead.',
};

/**
 * Ask whether there is a route to the repo from here.
 *
 * Any failure at all is "no". A 404, a 500, HTML from a static server, a
 * network error on a tunnel that dropped — all of them mean the same thing to
 * the author, and the fallback is always available, so there is nothing to be
 * gained by distinguishing them.
 */
export async function fetchAuthoringStatus(fetchFn: typeof fetch = fetch): Promise<AuthoringStatus> {
  try {
    const r = await fetchFn('/api/authoring', { headers: { accept: 'application/json' } });
    if (!r.ok) return OFFLINE;
    const j = (await r.json()) as Partial<AuthoringStatus>;
    if (!j || j.enabled !== true) return OFFLINE;
    return {
      enabled: true,
      root: typeof j.root === 'string' ? j.root : '',
      levels: Array.isArray(j.levels) ? j.levels : [],
      note: '',
    };
  } catch {
    return OFFLINE;
  }
}

export type SaveVerdict =
  | { can: true; route: 'repo'; label: string; note: string }
  | { can: true; route: 'download'; label: string; note: string }
  | { can: false; route: 'none'; label: string; note: string };

/**
 * What the save button says and whether it is live — the fork rule, surfaced.
 *
 * Pure, and it is the single place the editor decides this. The endpoint
 * enforces the same rule independently (see `writeAllowed`), which is the point:
 * this exists so the author is TOLD before they press it, not so the rule lives
 * in the client.
 */
export function saveVerdict(status: AuthoringStatus, doc: EditDoc): SaveVerdict {
  if (!ID_RE.test(doc.id)) {
    return { can: false, route: 'none', label: 'save', note: `"${doc.id}" is not a level id — lower-case letters, digits and dashes` };
  }
  if (doc.tier === 'core' || doc.tier === '') {
    return { can: false, route: 'none', label: 'save', note: 'tier "core" is the shipped set; the editor only writes drafts' };
  }
  if (!status.enabled) {
    return {
      can: true, route: 'download', label: `download ${doc.id}.json`,
      note: 'no authoring endpoint here — the file goes to your downloads folder and you move it into levels/ yourself. Run bin/dev to save directly.',
    };
  }
  const existing = status.levels.find((l) => l.id === doc.id);
  if (existing?.locked) {
    return {
      can: false, route: 'none', label: 'save',
      note: `levels/${doc.id}.json is a core level and is never overwritten. Change the id — that is what forking is for.`,
    };
  }
  if (existing) {
    return { can: true, route: 'repo', label: `overwrite levels/${doc.id}.json`, note: `replaces your ${existing.tier ?? 'draft'} of the same name` };
  }
  return { can: true, route: 'repo', label: `write levels/${doc.id}.json`, note: 'straight into the repo; the dev server picks it up' };
}

export interface SaveResult {
  ok: boolean;
  path: string;
  created: boolean;
  simHash: string;
  error: string | null;
}

export async function saveToRepo(doc: EditDoc, fetchFn: typeof fetch = fetch): Promise<SaveResult> {
  const body = JSON.stringify({ id: doc.id, level: JSON.parse(docToFileText(doc)) as unknown });
  try {
    const r = await fetchFn('/api/authoring/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const j = (await r.json()) as { path?: string; created?: boolean; simHash?: string; error?: string };
    if (!r.ok) return { ok: false, path: '', created: false, simHash: '', error: j.error ?? `HTTP ${r.status}` };
    return { ok: true, path: j.path ?? '', created: Boolean(j.created), simHash: j.simHash ?? '', error: null };
  } catch (e) {
    return { ok: false, path: '', created: false, simHash: '', error: e instanceof Error ? e.message : String(e) };
  }
}

/** The fallback route. Deliberately does both: a file AND the text, so either works. */
export function downloadLevel(doc: EditDoc): void {
  const text = docToFileText(doc);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}
