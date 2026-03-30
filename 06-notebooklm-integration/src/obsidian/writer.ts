import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionSummary, ObsidianSyncConfig } from '../types.js';

const SESSIONS_MARKER = '<!-- DEVNEURAL_SESSIONS_START -->';

/**
 * Derives a filesystem-safe slug from a project ID.
 * Strips 'project:' prefix, splits on / and \, takes last component lowercase.
 * Uses <penultimate>-<last> form on slug collision.
 */
export function deriveSlug(projectId: string, existingSlugs?: Map<string, string>): string {
  // Strip project: prefix
  const bare = projectId.startsWith('project:') ? projectId.slice('project:'.length) : projectId;

  // Split on both / and \ to handle URLs and Windows paths
  const parts = bare.split(/[/\\]/).filter(p => p.length > 0);

  const last = (parts[parts.length - 1] ?? '').toLowerCase();

  if (!existingSlugs) return last;

  // Check for collision
  const collision = [...existingSlugs.values()].includes(last);
  if (!collision) return last;

  // Use penultimate-last form
  const penultimate = (parts[parts.length - 2] ?? '').toLowerCase();
  return penultimate ? `${penultimate}-${last}` : last;
}

function removeSessionBlock(lines: string[], date: string): string[] {
  const startMarker = `## Session: ${date}`;
  const startIdx = lines.findIndex(l => l.trim() === startMarker);
  if (startIdx === -1) return lines;

  let endIdx = startIdx + 1;
  while (endIdx < lines.length && lines[endIdx].trim() !== '---') {
    endIdx++;
  }
  // Include the '---' line and any trailing blank line
  if (endIdx < lines.length) endIdx++;
  if (endIdx < lines.length && lines[endIdx].trim() === '') endIdx++;

  return [...lines.slice(0, startIdx), ...lines.slice(endIdx)];
}

/**
 * Returns the file path that writeSessionEntry would write to.
 * Pure function — no I/O.
 */
export function resolveNotePath(
  summary: Pick<SessionSummary, 'project'>,
  config: ObsidianSyncConfig,
): string {
  const slug = deriveSlug(summary.project);
  return path.join(config.vault_path, config.notes_subfolder, `${slug}.md`);
}

/**
 * Writes a rendered session summary to the appropriate Obsidian vault file.
 */
export function writeSessionEntry(
  summary: SessionSummary,
  rendered: string,
  config: ObsidianSyncConfig,
  options?: { force?: boolean; existingSlugs?: Map<string, string> },
): void {
  const slug = deriveSlug(summary.project, options?.existingSlugs);
  const filePath = path.join(config.vault_path, config.notes_subfolder, `${slug}.md`);

  // Ensure parent directories exist
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // New file path
  if (!fs.existsSync(filePath)) {
    const newContent = `# ${slug}\n${SESSIONS_MARKER}\n${rendered}`;
    fs.writeFileSync(filePath, newContent, { encoding: 'utf-8' });
    return;
  }

  // File exists — read current content
  let content = fs.readFileSync(filePath, { encoding: 'utf-8' });
  const sessionHeading = `## Session: ${summary.date}`;

  if (content.includes(sessionHeading)) {
    if (!options?.force) {
      console.log(`Session for ${summary.date} already exists in ${filePath}. Use --force to overwrite.`);
      return;
    }
    // Force: remove existing session block
    const lines = removeSessionBlock(content.split('\n'), summary.date);
    content = lines.join('\n');
  }

  if (config.prepend_sessions) {
    const markerIdx = content.indexOf(SESSIONS_MARKER);
    if (markerIdx !== -1) {
      // Insert after marker line
      const insertPos = markerIdx + SESSIONS_MARKER.length;
      content = content.slice(0, insertPos) + '\n' + rendered + content.slice(insertPos);
    } else {
      // Fallback: insert after first heading line
      const lines = content.split('\n');
      const headingIdx = lines.findIndex(l => l.startsWith('#'));
      const insertAt = headingIdx !== -1 ? headingIdx + 1 : 0;
      lines.splice(insertAt, 0, rendered);
      content = lines.join('\n');
    }
  } else {
    // Append mode — ensure at least one newline separator before new block
    content = (content.endsWith('\n') ? content : content + '\n') + rendered;
  }

  fs.writeFileSync(filePath, content, { encoding: 'utf-8' });
}
