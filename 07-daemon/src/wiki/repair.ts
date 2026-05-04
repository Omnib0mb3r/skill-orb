/**
 * One-shot wiki repair pass.
 *
 * Walks every .md under wiki/{pages,pending,archive}/, parses through
 * the current schema (which normalises cross-ref hrefs into the
 * canonical `./id.md` form), and re-writes the file. Pages that are
 * already clean re-write identical bytes; pages with historical
 * qwen3:8b drift (`./name.md.md`, `././name.md`, etc) get fixed in
 * place so future lint passes don't re-render the garbage from
 * crossRefsRaw.
 *
 * Idempotent. Safe to run alongside an active wiki backfill: writePage
 * is fs.writeFileSync, atomic enough for our crash model. Skipped if
 * file fails to parse so a malformed page doesn't blow up the run -
 * lint will surface those separately.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { wikiPagesDir, wikiPendingDir, wikiArchiveDir } from '../paths.js';
import { readPage, writePage } from './schema.js';

export interface WikiRepairResult {
  scanned: number;
  rewritten: number;
  unchanged: number;
  failed: number;
  errors: string[];
}

function listMd(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.posix.join(dir, f));
  } catch {
    return [];
  }
}

export function repairWikiCrossRefs(
  log: (msg: string) => void = () => undefined,
): WikiRepairResult {
  const result: WikiRepairResult = {
    scanned: 0,
    rewritten: 0,
    unchanged: 0,
    failed: 0,
    errors: [],
  };
  const dirs = [wikiPagesDir(), wikiPendingDir(), wikiArchiveDir()];
  for (const dir of dirs) {
    for (const file of listMd(dir)) {
      result.scanned += 1;
      try {
        const before = fs.readFileSync(file, 'utf-8');
        const page = readPage(file);
        // writePage validates + writes to <dir>/<id>.md. Re-derive dir
        // from the existing file path so a page sitting in wiki/pending
        // doesn't get relocated to wiki/pages.
        writePage(path.dirname(file).replace(/\\/g, '/'), page);
        const after = fs.readFileSync(file, 'utf-8');
        if (before === after) {
          result.unchanged += 1;
        } else {
          result.rewritten += 1;
        }
      } catch (err) {
        result.failed += 1;
        const msg = `${path.basename(file)}: ${(err as Error).message}`;
        result.errors.push(msg);
        log(`[wiki-repair] ${msg}`);
      }
    }
  }
  log(
    `[wiki-repair] scanned=${result.scanned} rewritten=${result.rewritten} unchanged=${result.unchanged} failed=${result.failed}`,
  );
  return result;
}
