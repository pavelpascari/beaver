# Beaver Session Analysis

> Generated: 2026-04-16T23:21:13.962Z
> Mode: hybrid (claude-sonnet-4-6) | Provider: claude

## TL;DR

**Shipped a large cross-cutting LLM upgrade but paid 5x the expected retry tax and wrote 4x as many files as the task warranted.**

## Friction Score

**76/100** 🔴 — Grade **F** — _Severe friction — tooling-dominated (retry_loops)_

`███████████████░░░░░`

| Category | Points |
|----------|--------|
| Tooling Friction | 29 |
| Discovery Friction | 16.5 |
| Verification Friction | 15 |
| Boundary Friction | 15 |

**Top contributors:**

- `+20` 10 retries — tools or edits failed and had to be repeated
- `+16.5` 16 file reads — excessive exploration suggests unclear entry points
- `+15` 8 test runs — feedback loop required many iterations
- `+15` 25 unique files touched — change spread across many modules
- `+9` 4 file(s) edited multiple times — iterative edits suggest unclear target state

## Task Summary

```
The agent evolved Beaver from a pure heuristics engine to an LLM-augmented analysis tool, introducing friction scoring, expected-vs-observed reasoning, new type layers (scoring.ts, expectations.ts), a prompts module, and updated CLI/markdown renderers. The change touched every architectural layer — types, analysis, finalizer, render, CLI — which explains the sprawl. The work landed, but the path was jagged: 10 retries, 35 writes, and 8 test runs suggest the agent was clarifying the design while executing it.
```

## Expected vs Observed

**Task complexity:** `large`

- **Expected:** For a well-scoped cross-cutting feature of this size, expect 1 tight exploration pass (~18 reads), 8–10 targeted writes, a handful of type-level ripples, and 4–5 test runs to confirm the LLM pipeline wires up correctly — total friction driven mostly by integration uncertainty, not edit instability.
- **Observed:** Instead, the agent read broadly across 11 files before writing anything, then produced 35 writes scattered across 25 files — nearly the entire src tree — and retried edits 10 times, with 5 of those retries concentrated in README.md alone, betraying a late-session documentation struggle that had nothing to do with the core feature.
- **Biggest divergence:** File writes came in at 35 against an expectation of 8 — a 4.4x overshoot that signals the implementation was being designed in-flight rather than from a settled plan.

| Metric | Expected | Observed | Δ | Interpretation |
|--------|---------:|---------:|:-:|----------------|
| file_reads | 18 | 16 | ✓ -2 | roughly as many reads as expected |
| file_writes | 8 | 35 | 🔺 +27 | more writes than expected — change was larger or more iterative than needed |
| searches | 6 | 1 | 🔻 -5 | few searches — navigation was direct |
| retries | 2 | 10 | 🔺 +8 | more retries than expected — tooling or edits were unreliable |
| test_runs | 5 | 8 | 🔺 +3 | more test iterations than expected — feedback loop was noisy or slow |
| unique_files_touched | 14 | 25 | 🔺 +11 | touched more files than expected — change crossed more boundaries than needed |
| exploration_share_pct | 40 | 27 | 🔻 -13 | less time exploring than expected — the agent moved to action quickly |

## Effort Breakdown

| Phase | Effort |
|-------|--------|
| Exploration | 27% `█████░░░░░░░░░░░░░░░` |
| Implementation | 61% `████████████░░░░░░░░` |
| Debugging | 0% `░░░░░░░░░░░░░░░░░░░░` |
| Verification | 12% `██░░░░░░░░░░░░░░░░░░` |

## Key Signals

| Signal | Count |
|--------|-------|
| Files read | 16 |
| Files written | 35 |
| Searches | 1 |
| Edits | 35 |
| Retries | 10 |
| Test runs | 8 |
| Commands | 48 |
| Unique files touched | 25 |

<details>
<summary>Files touched</summary>

- `/home/user/beaver/package.json`
- `/home/user/beaver/src/cli/index.ts`
- `/home/user/beaver/src/analysis/prompts.ts`
- `/home/user/beaver/src/types/report.ts`
- `/home/user/beaver/src/types/chunks.ts`
- `/home/user/beaver/src/finalizer/finalizer.ts`
- `/home/user/beaver/src/render/cli.ts`
- `/home/user/beaver/src/render/markdown.ts`
- `/home/user/beaver/src/analysis/heuristic.ts`
- `/home/user/beaver/src/types/session.ts`
- `/home/user/beaver/src/types/events.ts`
- `/home/user/beaver/src/types/scoring.ts`
- `/home/user/beaver/src/types/expectations.ts`
- `/home/user/beaver/src/analysis/scoring.ts`
- `/home/user/beaver/src/analysis/expectations.ts`
- `/home/user/beaver/src/analysis/llm-client.ts`
- `/home/user/beaver/src/analysis/llm-insight.ts`
- `/home/user/beaver/examples/example-session.json`
- `/home/user/beaver/src/analysis/__tests__/scoring.test.ts`
- `/home/user/beaver/src/analysis/__tests__/expectations.test.ts`
- `/home/user/beaver/src/analysis/__tests__/llm-client.test.ts`
- `/home/user/beaver/src/finalizer/__tests__/finalizer.test.ts`
- `/home/user/beaver/README.md`
- `/home/user/beaver/src/analysis/__tests__/auth.test.ts`
- `/tmp/claude-0/-home-user-beaver/30d3a215-d70d-41b8-a95b-11655244f401/tasks/bu81edl6w.output`

</details>

## Friction Analysis

### Primary Friction

🔴 **Tooling Friction** (high)

Phase 9 alone accounts for 5 retries, all concentrated in README.md — a large structured markdown file that the Edit tool consistently struggles with when changes span non-contiguous sections. This is not a reasoning failure; it is a mechanical mismatch between the Edit tool's exact-string matching and a document whose surrounding context shifts with each partial write. The same pattern (2 retries, repeated edits) surfaced in report.ts, cli/index.ts, and llm-client.ts, suggesting the agent was also chasing moving type signatures mid-session.

> Phase 9: 5 retries + 6 writes all targeting /home/user/beaver/README.md — the highest retry density of any single-file phase in the session
> Phases 3, 16, 21 each logged 2 retries with 'files edited multiple times' on report.ts, cli/index.ts, and llm-client.ts respectively — a retry pattern that tracks the order of type propagation

### Secondary Friction

🟡 **Boundary Friction** (medium)

Task touched many files/modules. Responsibilities may not be well-encapsulated, or the change is inherently cross-cutting.

> Detected in exploration phase: exploration phase with 16 events, 11 file reads, 2 commands, across 11 file(s)
> Detected in implementation phase: implementation phase with 23 events, 13 file writes, 1 searches, 2 retries, across 11 file(s)
> Broad exploration — read 11 different files (may indicate unclear entry point)
> Scattered implementation — writes spread across 11 files (may indicate cross-cutting change)

🟢 **Verification Friction** (low)

Testing and validation took more effort than expected. Test setup, feedback loops, or CI may be slow or fragile.

> Detected in implementation phase: implementation phase with 7 events, 2 file writes, 1 test runs, 1 retries, 3 commands, across 1 file(s)

## Evidence

- **Read 11 files — agent may have been unsure where to look**
  Detected during exploration phase (16 events) _(exploration)_

- **Broad exploration — read 11 different files (may indicate unclear entry point)**
  Observed in exploration phase _(exploration)_

- **2 retries detected — earlier attempts failed or were incomplete**
  Detected during implementation phase (23 events) _(implementation)_

- **Files edited multiple times: /home/user/beaver/src/types/report.ts**
  Detected during implementation phase (23 events) _(implementation)_

- **Scattered implementation — writes spread across 11 files (may indicate cross-cutting change)**
  Observed in implementation phase _(implementation)_

- **5 retries detected — earlier attempts failed or were incomplete**
  Detected during implementation phase (11 events) _(implementation)_

- **Files edited multiple times: /home/user/beaver/README.md**
  Detected during implementation phase (11 events) _(implementation)_

- **Focused implementation — 6 edits concentrated in 1 file(s)**
  Observed in implementation phase _(implementation)_

- **2 retries detected — earlier attempts failed or were incomplete**
  Detected during implementation phase (8 events) _(implementation)_

- **Files edited multiple times: /home/user/beaver/src/cli/index.ts**
  Detected during implementation phase (8 events) _(implementation)_

- **Focused implementation — 5 edits concentrated in 3 file(s)**
  Observed in implementation phase _(implementation)_

- **1 retries detected — earlier attempts failed or were incomplete**
  Detected during implementation phase (7 events) _(implementation)_

- **Files edited multiple times: /home/user/beaver/src/analysis/llm-client.ts**
  Detected during implementation phase (7 events) _(implementation)_


## Recommendations

### 1. Add CLAUDE.md with module responsibility map _(llm)_

Phase 2's 11-file read sweep with a single search is a strong signal that the agent had no authoritative map of the codebase. A CLAUDE.md at the repo root that lists each src/ subdirectory, its owner module, and its public surface (e.g. 'analysis/heuristic.ts → exports analyzeSession(chunks): HeuristicReport') would let future sessions skip the archaeology pass entirely. This is the highest-leverage doc change possible: it directly cuts exploration time for every subsequent agent run.

**Targets:** `/home/user/beaver/CLAUDE.md`, `/home/user/beaver/src/`

**Success metric:** Exploration share drops below 20% and file reads in the first exploration phase drop below 5 on the next cross-cutting task.

```
## Module map
| Path | Responsibility | Key exports |
|------|---------------|-------------|
| src/analysis/heuristic.ts | Heuristic signal extraction | `analyzeSession` |
| src/analysis/scoring.ts | Friction score calculation | `scoreFriction` |
| src/analysis/expectations.ts | Expected vs observed deltas | `computeExpectations` |
| src/analysis/prompts.ts | LLM prompt builders | `buildFinalizerPrompt` |
| src/finalizer/finalizer.ts | Orchestrates analysis pipeline | `finalize` |
| src/render/cli.ts | Terminal output | `renderCLI` |
| src/render/markdown.ts | Markdown report | `renderMarkdown` |
```

🟢 **Impact:** high | **Effort:** low | _Discovery Friction_

### 2. Replace Edit-based README updates with a script _(llm)_

Five retries on README.md in phase 9 is a clear tooling failure, not a reasoning failure. Large markdown files with numbered sections, code blocks, and inline tables are the worst-case input for exact-string Edit matching — any prior partial write shifts surrounding context and breaks the next match. Move the dynamic parts of the README (feature list, example output, changelog) into a generate-readme.ts script that writes the file from structured data, so future sessions can update structured inputs rather than fight the Edit tool on raw markdown.

**Targets:** `/home/user/beaver/README.md`, `/home/user/beaver/scripts/generate-readme.ts`

**Success metric:** Zero retries on README.md in any subsequent session; README updates take 1 write, not 6.

🟡 **Impact:** medium | **Effort:** medium | _Tooling Friction_

### 3. Add a mock-backed smoke test for the LLM pipeline _(llm)_

Phase 21 shows the classic LLM integration pattern: code compiles, first test run fails, retry on llm-client.ts, second run passes. With 8 total test runs across the session, each cycle was expensive. Add a test in src/analysis/__tests__/llm-client.test.ts that stubs the Anthropic SDK response and exercises the full buildFinalizerPrompt → call → parse path with a fixture. This gives the agent a fast (<2s) signal on wiring correctness before spinning up real API calls.

**Targets:** `/home/user/beaver/src/analysis/llm-client.ts`, `/home/user/beaver/src/analysis/__tests__/llm-client.test.ts`

**Success metric:** Test runs on the next LLM-touching session drop to ≤4, and phase 21-style retry+test sequences disappear.

```
// __tests__/llm-client.test.ts
const mockClient = { messages: { create: jest.fn().mockResolvedValue({ content: [{ text: '{"headline":"test"}' }] }) } };
it('parses LLM response into report shape', async () => {
  const result = await callLLM(mockClient, buildFinalizerPrompt(fixtureChunks));
  expect(result).toHaveProperty('headline');
});
```

🟢 **Impact:** high | **Effort:** low | _Verification Friction_

### 4. Pin new type modules behind a single analysis barrel _(llm)_

The 35 writes across 25 files partly reflect type ripples: adding scoring.ts and expectations.ts required updating report.ts, then both renderers, then the CLI, then the finalizer — each import site had to be touched individually. An src/analysis/index.ts barrel that re-exports all analysis-layer types would let the renderers and CLI import from a single stable path, so adding a new analysis module in the future only requires updating the barrel and the new file, not every consumer.

**Targets:** `/home/user/beaver/src/analysis/index.ts`, `/home/user/beaver/src/render/cli.ts`, `/home/user/beaver/src/render/markdown.ts`

**Success metric:** Unique files touched on the next analysis-layer addition drops below 10; report.ts stops appearing in 'files edited multiple times' signals.

```
// src/analysis/index.ts
export * from './heuristic';
export * from './scoring';
export * from './expectations';
export * from './prompts';
export * from './llm-client';
```

🟡 **Impact:** medium | **Effort:** low | _Boundary Friction_

### 5. Streamline test feedback loop

Multiple test runs suggest the test cycle is slow or flaky. Consider faster unit tests, watch mode, or focused test commands.

**Success metric:** first test run passes on next session

🟡 **Impact:** medium | **Effort:** medium | _Verification Friction_

### 6. Fix unreliable tooling

Tool retries indicate flaky builds, tests, or development tools. Investing in reliable tooling reduces agent iteration cycles.

**Success metric:** zero retries in next session

🟢 **Impact:** high | **Effort:** medium | _Tooling Friction_

### 7. Review module boundaries

Changes touched 20 files. If this is a common pattern, consider whether module boundaries could be refactored to reduce cross-cutting changes.

**Targets:** `/home/user/beaver/README.md`, `/home/user/beaver/src/analysis/llm-client.ts`, `/home/user/beaver/src/cli/index.ts`, `/home/user/beaver/src/types/report.ts`, `/home/user/beaver/src/types/scoring.ts`

🟡 **Impact:** medium | **Effort:** high | _Boundary Friction_

## Git Context

- **Type:** single_repo
- **Repo:** `/home/user/beaver`
- **Branch:** `claude/add-llm-analysis-Z772H`
- **Status:** Has uncommitted changes

## Phase Details

### 🛠️ Implementation (1 events)

implementation phase with 1 events, 1 commands

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

### 🔍 Exploration (16 events)

exploration phase with 16 events, 11 file reads, 2 commands, across 11 file(s)

> ✦ Phase 2's 11-file read sweep — spanning session.ts, events.ts, chunks.ts, heuristic.ts, finalizer.ts, cli.ts, markdown.ts — was manual archaeology with only 1 search in the entire session. The agent reconstructed the call graph by reading files rather than querying it, which is recoverable but slower than it should be for a codebase with stable module names.

**Effort signals:**
- `[high]` Read 11 files — agent may have been unsure where to look

**Patterns:**
- Broad exploration — read 11 different files (may indicate unclear entry point)

### 🛠️ Implementation (23 events)

implementation phase with 23 events, 13 file writes, 1 searches, 2 retries, across 11 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

**Effort signals:**
- `[medium]` 2 retries detected — earlier attempts failed or were incomplete
- `[medium]` Files edited multiple times: /home/user/beaver/src/types/report.ts

**Patterns:**
- Scattered implementation — writes spread across 11 files (may indicate cross-cutting change)

### 🛠️ Implementation (6 events)

implementation phase with 6 events, 3 file writes, 3 commands, across 3 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

### 🔍 Exploration (2 events)

exploration phase with 2 events, 1 file reads, across 1 file(s)

> ✦ Phase 2's 11-file read sweep — spanning session.ts, events.ts, chunks.ts, heuristic.ts, finalizer.ts, cli.ts, markdown.ts — was manual archaeology with only 1 search in the entire session. The agent reconstructed the call graph by reading files rather than querying it, which is recoverable but slower than it should be for a codebase with stable module names.

### 🛠️ Implementation (4 events)

implementation phase with 4 events, 4 file writes, across 4 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

### ✅ Verification (2 events)

verification phase with 2 events, 2 test runs

> ✦ Phase 21 combined a test run with a retry on llm-client.ts, which is the expected failure mode for LLM integration wiring: the client compiled but misbehaved at runtime. The 8 total test runs across phases 7, 10, 17, 21, 22 suggest no fast mock path existed — each verification cycle had to spin up real infrastructure.

### 🛠️ Implementation (4 events)

implementation phase with 4 events, 1 file reads, 3 commands, across 1 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

### 🛠️ Implementation (11 events)

implementation phase with 11 events, 6 file writes, 5 retries, across 1 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

**Effort signals:**
- `[high]` 5 retries detected — earlier attempts failed or were incomplete
- `[medium]` Files edited multiple times: /home/user/beaver/README.md

**Patterns:**
- Focused implementation — 6 edits concentrated in 1 file(s)

### ✅ Verification (10 events)

verification phase with 10 events, 2 test runs, 6 commands

> ✦ Phase 21 combined a test run with a retry on llm-client.ts, which is the expected failure mode for LLM integration wiring: the client compiled but misbehaved at runtime. The 8 total test runs across phases 7, 10, 17, 21, 22 suggest no fast mock path existed — each verification cycle had to spin up real infrastructure.

### 🔍 Exploration (5 events)

exploration phase with 5 events, 5 commands

> ✦ Phase 2's 11-file read sweep — spanning session.ts, events.ts, chunks.ts, heuristic.ts, finalizer.ts, cli.ts, markdown.ts — was manual archaeology with only 1 search in the entire session. The agent reconstructed the call graph by reading files rather than querying it, which is recoverable but slower than it should be for a codebase with stable module names.

### 🛠️ Implementation (2 events)

implementation phase with 2 events, 2 commands

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

### 🔍 Exploration (3 events)

exploration phase with 3 events, 3 commands

> ✦ Phase 2's 11-file read sweep — spanning session.ts, events.ts, chunks.ts, heuristic.ts, finalizer.ts, cli.ts, markdown.ts — was manual archaeology with only 1 search in the entire session. The agent reconstructed the call graph by reading files rather than querying it, which is recoverable but slower than it should be for a codebase with stable module names.

### 🔍 Exploration (2 events)

exploration phase with 2 events, 1 file reads, across 1 file(s)

> ✦ Phase 2's 11-file read sweep — spanning session.ts, events.ts, chunks.ts, heuristic.ts, finalizer.ts, cli.ts, markdown.ts — was manual archaeology with only 1 search in the entire session. The agent reconstructed the call graph by reading files rather than querying it, which is recoverable but slower than it should be for a codebase with stable module names.

### 🛠️ Implementation (3 events)

implementation phase with 3 events, 1 file reads, 1 file writes, 1 commands, across 1 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

### 🛠️ Implementation (8 events)

implementation phase with 8 events, 5 file writes, 2 retries, 1 commands, across 3 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

**Effort signals:**
- `[medium]` 2 retries detected — earlier attempts failed or were incomplete
- `[medium]` Files edited multiple times: /home/user/beaver/src/cli/index.ts

**Patterns:**
- Focused implementation — 5 edits concentrated in 3 file(s)

### ✅ Verification (4 events)

verification phase with 4 events, 2 test runs, 1 commands

> ✦ Phase 21 combined a test run with a retry on llm-client.ts, which is the expected failure mode for LLM integration wiring: the client compiled but misbehaved at runtime. The 8 total test runs across phases 7, 10, 17, 21, 22 suggest no fast mock path existed — each verification cycle had to spin up real infrastructure.

### 🔍 Exploration (6 events)

exploration phase with 6 events, 1 file reads, 5 commands, across 1 file(s)

> ✦ Phase 2's 11-file read sweep — spanning session.ts, events.ts, chunks.ts, heuristic.ts, finalizer.ts, cli.ts, markdown.ts — was manual archaeology with only 1 search in the entire session. The agent reconstructed the call graph by reading files rather than querying it, which is recoverable but slower than it should be for a codebase with stable module names.

### 🛠️ Implementation (6 events)

implementation phase with 6 events, 6 commands

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

### 🔍 Exploration (2 events)

exploration phase with 2 events, 2 commands

> ✦ Phase 2's 11-file read sweep — spanning session.ts, events.ts, chunks.ts, heuristic.ts, finalizer.ts, cli.ts, markdown.ts — was manual archaeology with only 1 search in the entire session. The agent reconstructed the call graph by reading files rather than querying it, which is recoverable but slower than it should be for a codebase with stable module names.

### 🛠️ Implementation (7 events)

implementation phase with 7 events, 2 file writes, 1 test runs, 1 retries, 3 commands, across 1 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

**Effort signals:**
- `[medium]` 1 retries detected — earlier attempts failed or were incomplete
- `[medium]` Files edited multiple times: /home/user/beaver/src/analysis/llm-client.ts

### 🛠️ Implementation (8 events)

implementation phase with 8 events, 1 file writes, 1 test runs, 4 commands, across 1 file(s)

> ✦ The scatter is real but partially justified: adding scoring.ts, expectations.ts, and prompts.ts as new modules correctly required updates to types/report.ts, finalizer.ts, and both renderers. What was not justified was the 5-retry cluster on README.md (phase 9) and repeated edits to cli/index.ts (phase 16) — those reflect unstable target state, not architectural necessity.

---
*Beaver v0.2.0 — Compounding improvement, one session at a time.*
*LLM tokens: 17680*
