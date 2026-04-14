# Beaver

A local-first CLI tool that analyzes coding agent sessions, identifies friction, and suggests improvements that compound over time.

## What is Beaver?

After a coding agent (Claude, Codex, etc.) completes a task, Beaver analyzes the session and answers:

- **What happened?** — Task summary and event breakdown
- **Where was effort spent?** — Exploration vs. implementation vs. debugging vs. verification
- **What was harder than it should have been?** — Friction detection with evidence
- **What should change?** — Actionable recommendations for next time

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
  -f, --format <format>  Output format: cli or markdown (default: "cli")
  -o, --output <path>    Write report to file instead of stdout
  --provider <provider>  Session provider (auto-detected if omitted)
```

## What a Report Contains

1. **Task summary** — What the agent was asked to do
2. **Effort breakdown** — % split across exploration, implementation, debugging, verification
3. **Key signals** — Files read/written, searches, retries, test runs
4. **Friction analysis** — Primary and secondary friction with severity
5. **Evidence** — Specific observations backing each claim
6. **Recommendations** — Actionable improvements ranked by impact and effort

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
  analysis/     Heuristic analysis + LLM prompt templates
  finalizer/    Aggregation into final report
  render/       Output renderers (CLI pretty-print + Markdown)
  types/        Shared type definitions
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
- **Minimal dependencies** — Only `commander` for CLI parsing. No LLM SDK (yet), no heavy frameworks
- **Heuristic-first** — MVP uses pattern matching and heuristics. LLM prompt templates are included and ready for integration
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

- LLM-powered chunk and finalizer analysis (prompts are ready)
- Additional session providers (Codex, Cursor, Aider)
- Multi-session aggregation (track friction trends over time)
- CLAUDE.md generation from analysis patterns
- Git diff integration for richer context

## License

MIT
