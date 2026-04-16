# Beaver

A local-first CLI tool that analyzes coding agent sessions, identifies friction, and suggests improvements that compound over time.

## What is Beaver?

After a coding agent (Claude, Codex, etc.) completes a task, Beaver analyzes the session and answers:

- **What happened?** — Task summary and event breakdown
- **Where was effort spent?** — Exploration vs. implementation vs. debugging vs. verification
- **How painful was it?** — A 0–100 friction score with letter grade and per-category breakdown
- **What was expected vs what actually happened?** — A baseline of how a well-run session should look, contrasted against the observed session
- **What was harder than it should have been?** — Friction detection with evidence
- **What should change?** — Actionable recommendations with file targets, success metrics, and (optionally) LLM-authored specificity

Beaver is a **reflection tool**, not a runtime. Small improvements discovered from each session compound into a system that becomes easier and faster for agents to operate in.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Analyze a session
beaver analyze session.json

# Markdown output
beaver analyze session.json -f markdown -o report.md
```

## Usage

```
beaver analyze <session_file> [options]

Options:
  -f, --format <format>   Output format: cli or markdown (default: "cli")
  -o, --output <path>     Write report to file instead of stdout
  --provider <provider>   Session provider (auto-detected if omitted)
  --llm                   Enable LLM-powered insight layer (requires ANTHROPIC_API_KEY)
  --model <id>            Override LLM model (default: claude-sonnet-4-6)
  --api-key <key>         Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
  --llm-timeout <ms>      LLM request timeout in ms (default: 60000)
```

### Heuristic vs LLM mode

Beaver runs in **heuristic mode by default** — no network calls, instant analysis. Pass `--llm` to add a single, high-leverage LLM call that refines the narrative, classifies task complexity, and produces specific recommendations with targets and success metrics. The heuristic score and expected-vs-observed baseline still run first; the LLM only adds judgment on top.

If the LLM call fails (missing key, network, invalid response), Beaver falls back cleanly to heuristic output and records the reason in the report metadata.

```bash
export ANTHROPIC_API_KEY=sk-...
beaver analyze session.json --llm
```

### Authentication

`--llm` supports three auth modes, resolved in this order:

1. `--api-key <key>` flag (explicit override) → sent as `x-api-key`
2. `ANTHROPIC_API_KEY` env var → sent as `x-api-key`
3. **`claude` CLI on PATH** → spawns `claude -p` and delegates the call to your local Claude Code installation. No credential is handled by Beaver; Claude uses whatever auth you've already set up.
4. `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` env var → sent as `Authorization: Bearer` with `anthropic-beta: oauth-2025-04-20` (real Anthropic OAuth flows)

Force a specific mode with `--auth {api_key,oauth,claude_cli}`. The base URL for the HTTP modes is taken from `ANTHROPIC_BASE_URL` if set.

**Recommended setup when running inside Claude Code:** the harness-provided OAuth token is scoped to Claude Code's own session endpoint and returns `401 Invalid bearer token` against `/v1/messages`. Use `--auth claude_cli` (or just rely on auto-detection — Beaver picks it over the harness OAuth). The CLI path spawns claude from `os.tmpdir()` with a tight system prompt to avoid loading project context that would otherwise trigger multi-turn tool use, keeping the call to ~3–10s.

## What a Report Contains

1. **Headline / TL;DR** — One-line executive summary of how the session went
2. **Friction score** — 0–100 numeric score with letter grade (A–F), per-category breakdown, and ranked contributors
3. **Task summary** — What the agent was asked to do
4. **Expected vs observed** — Baseline expectations for a task of this complexity vs what actually happened, with a per-metric delta table and the "biggest divergence"
5. **Effort breakdown** — % split across exploration, implementation, debugging, verification
6. **Key signals** — Files read/written, searches, retries, test runs
7. **Friction analysis** — Primary and secondary friction with severity
8. **Evidence** — Specific observations backing each claim
9. **Recommendations** — Actionable improvements ranked by impact/effort, with concrete targets, success metrics, and optional drop-in snippets

### Friction Categories

| Category | Meaning |
|----------|---------|
| Discovery friction | Agent spent too long finding relevant code |
| Interpretation friction | Agent misunderstood requirements or code patterns |
| Tooling friction | Tools failed or required retries |
| Verification friction | Testing/validation was harder than expected |
| Boundary friction | Changes crossed too many module boundaries |
| Spec friction | Requirements were unclear or incomplete |
| Retrieval friction | Agent couldn't efficiently find information through search |

## Examples

The `examples/` folder contains sample sessions and their generated reports:

| File | Description |
|------|-------------|
| `examples/example-session.json` | Synthetic session: agent fixing a login form validation bug |
| `examples/example-report.md` | Generated report for the above |
| `examples/beaver-build-session.jsonl` | Real Claude Code session: building Beaver itself |
| `examples/beaver-build-report.md` | Generated report for the above |

```bash
# Analyze the synthetic example
beaver analyze examples/example-session.json

# Analyze the real session (Beaver building itself)
beaver analyze examples/beaver-build-session.jsonl

# Output as markdown
beaver analyze examples/example-session.json -f markdown -o report.md
```

The synthetic example session shows an agent that:
- Explores 7+ files to find the validation logic
- Fixes an email regex and adds change-event validation
- Hits test failures due to incomplete first pass (forgot password field, forgot test mock)
- Revises approach mid-task
- Eventually gets all tests passing

Beaver detects discovery friction (too many files read), verification friction (multiple test iterations), and interpretation friction (plan revision needed), then recommends adding a CLAUDE.md file and streamlining the test feedback loop.

## Architecture

```
src/
  cli/          CLI entrypoint (commander)
  parser/       Session file parsers (Claude Code format)
  events/       Event extraction from parsed sessions
  chunking/     Phase detection (exploration/implementation/debugging/verification)
  analysis/     Heuristic analysis, scoring, expected-vs-observed, LLM client + prompts
  finalizer/    Aggregation into final report (merges heuristic + LLM layers)
  render/       Output renderers (CLI pretty-print + Markdown)
  types/        Shared type definitions (session, events, chunks, scoring, expectations, report)
```

### Data Flow

```
session file → parser → canonical Session
                           ↓
                     event extraction → SessionEvent[]
                           ↓
                       chunking → Chunk[] (phases)
                           ↓
                     analysis → ChunkAnalysis[]
                           ↓
                      finalizer → Report
                           ↓
                      renderer → CLI output or Markdown
```

### Design Decisions

- **TypeScript** — Type safety for the analysis pipeline, fast iteration, good CLI ecosystem
- **Minimal dependencies** — Only `commander` for CLI parsing. LLM calls use native `fetch` against Anthropic's Messages API — no SDK dependency
- **Heuristic-first, LLM-on-top** — The scoring model and expected-vs-observed baseline are deterministic and always run. The LLM layer is a single high-leverage call that adds narrative and specificity on top of the heuristic signals it was given
- **Graceful fallback** — If the LLM call fails for any reason, Beaver silently degrades to heuristic output and records the fallback reason in the report metadata
- **Extensible parser** — Parser layer normalizes into a canonical `Session` type. Adding new providers (Codex, Cursor, etc.) means adding a new parser function
- **Clean module boundaries** — Each module has a single responsibility and communicates through typed interfaces

## Session File Formats

Beaver currently supports Claude Code sessions in:

- **JSON array** — `[{role, content, ...}, ...]`
- **NDJSON** — One JSON object per line (Claude Code export format)

The parser handles both automatically.

## Development

```bash
npm install          # Install dependencies
npm run build        # Build once
npm run dev          # Watch mode
npm run beaver       # Run CLI
```

## Future Directions

- Per-chunk LLM deep-dive mode (prompts are ready — currently we prefer one high-leverage call per session for cost)
- Additional session providers (Codex, Cursor, Aider)
- Multi-session aggregation (track friction trends over time)
- CLAUDE.md auto-generation from analysis patterns
- Git diff integration for richer context
- Task-type-aware baselines (bugfix vs feature vs refactor have different healthy profiles)

## License

MIT
