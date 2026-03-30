import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { readSessionLog } from './session/log-reader.js';
import { extractGraphInsights } from './session/graph-reader.js';
import { generateSummary } from './summary/generator.js';
import { renderSummary } from './summary/renderer.js';
import { writeSessionEntry, resolveNotePath } from './obsidian/writer.js';
import type { ObsidianSyncConfig } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineOptions {
  date?: string;
  project?: string;
  dryRun?: boolean;
  force?: boolean;
  configPath?: string;
}

interface InternalPipelineOptions extends PipelineOptions {
  /** Inject config directly — used in tests to bypass loadConfig. */
  _config?: ObsidianSyncConfig;
}

export interface PipelineResult {
  exitCode: 0 | 1;
  message: string;
  outputPath?: string;
  rendered?: string;
}

// ─── Arg Parsing ──────────────────────────────────────────────────────────────

const USAGE = `Usage: node dist/generate-summary.js [options]

Options:
  --date YYYY-MM-DD    Generate summary for a specific date (default: today UTC)
                       Note: dates are UTC — run with --date $(date -u +%Y-%m-%d) on Linux/Mac
                       to use your local date if you work past midnight UTC
  --project <name>     Override project detection
  --dry-run            Print generated markdown to stdout, don't write to vault
  --force              Overwrite existing session entry for the same date
  --config <path>      Path to config.json (default: ./config.json)
  --help               Show this help

Required environment:
  ANTHROPIC_API_KEY    Anthropic API key for Claude summary generation`;

export function parseArgs(argv: string[]): PipelineOptions & { help?: boolean } {
  const opts: PipelineOptions & { help?: boolean } = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--date') {
      if (++i >= argv.length) { process.stderr.write('--date requires a value\n'); process.exit(1); }
      opts.date = argv[i];
    } else if (arg === '--project') {
      if (++i >= argv.length) { process.stderr.write('--project requires a value\n'); process.exit(1); }
      opts.project = argv[i];
    } else if (arg === '--config') {
      if (++i >= argv.length) { process.stderr.write('--config requires a value\n'); process.exit(1); }
      opts.configPath = argv[i];
    } else {
      process.stderr.write(`Unknown option: ${arg}\n`);
      process.exit(1);
    }
    i++;
  }
  return opts;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const opts = options as InternalPipelineOptions;

  // 1. Resolve config path
  const configPath = opts.configPath
    ? path.resolve(opts.configPath)
    : path.resolve(process.cwd(), 'config.json');

  // 2. Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      exitCode: 1,
      message:
        'Error: ANTHROPIC_API_KEY is not set. Export it before running devneural-obsidian-sync.',
    };
  }

  // 3. Load config (or use injected _config from tests)
  const config: ObsidianSyncConfig = opts._config ?? loadConfig(configPath);

  // 4. Determine target date
  const targetDate = opts.date ?? new Date().toISOString().slice(0, 10);

  // 5. Read session log
  const sessionData = await readSessionLog(targetDate, config.data_root);
  if (sessionData === null) {
    return {
      exitCode: 0,
      message: `No DevNeural activity found for ${targetDate}. Nothing to write.`,
    };
  }

  // 6. Override primary project if provided
  if (opts.project) {
    sessionData.primary_project = opts.project;
  }

  // 7. Extract graph insights
  const insights = await extractGraphInsights(sessionData.primary_project, targetDate, config);

  // 8. Generate summary via Claude
  const summary = await generateSummary(sessionData, insights, config);

  // 9. Render to markdown
  const renderedMarkdown = renderSummary(summary);

  // 10. Dry run — return without writing
  if (opts.dryRun) {
    return {
      exitCode: 0,
      message: 'Dry run complete.',
      rendered: renderedMarkdown,
    };
  }

  // 11. Write to vault
  writeSessionEntry(summary, renderedMarkdown, config, { force: opts.force ?? false });

  // 12. Resolve output path
  const outputPath = resolveNotePath(summary, config);

  return {
    exitCode: 0,
    message: `✓ Session note written: ${outputPath}`,
    outputPath,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }

  try {
    const result = await runPipeline(opts);

    if (result.exitCode === 0) {
      if (opts.dryRun && result.rendered) {
        console.log(result.rendered);
      } else {
        console.log(result.message);
      }
    } else {
      console.error(result.message);
    }

    process.exit(result.exitCode);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
