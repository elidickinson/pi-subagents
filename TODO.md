# pi-subagents TODO

Remaining low-priority issues from code analysis. All critical/medium issues are fixed.

## Correctness (Low Priority)

### 1. Parent signal listener leak (agent-manager.ts:113-116)
- **Issue:** `parentSignal` abort listener attached in `spawn()` before agent is dequeued
- **Risk:** If parent aborts while agent is queued, handler fires but agent hasn't started
- **Fix:** Attach listener after agent is dequeued and actually running

### 2. Status overwrite when aborting (agent-manager.ts:185-190)
- **Issue:** Catch block sets `record.error` even if `record.status === "stopped"`
- **Risk:** May overwrite abort-specific error with generic error message
- **Fix:** Only set `record.error` when `record.status !== "stopped"`

### 3. `steered` flag wrong when aborted (agent-runner.ts:317)
- **Issue:** Returns `steered: softLimitReached` even if agent was later aborted after grace period
- **Risk:** Semantically misleading — both `aborted` and `steered` are true
- **Fix:** `steered: softLimitReached && !aborted`

### 4. `thinkingLevel` API cast (agent-runner.ts:~260)
- **Issue:** Casts `thinkingLevel` into `createAgentSession` options without verifying API accepts it
- **Risk:** If pi API doesn't support this property, thinking level is silently ignored
- **Fix:** Verify against `reference-code/pi-mono/packages/coding-agent/src/core/extensions/types.ts`

### 5. Resume invisible to widget/events (agent-manager.ts:242-273)
- **Issue:** `resume()` resets record but doesn't emit `subagents:started` or wire to widget
- **Risk:** Resumed agents are invisible to UI and event system
- **Fix:** Emit events and set up activity tracking in resume path

## Maintainability

### 6. Split `index.ts` (1600+ lines)
Consider extracting into focused modules:
- `agent-tool.ts` — tool registration and execution
- `command-menu.ts` — `/agents` menu and wizard
- `batch-tracker.ts` — smart-join batch logic
- `index.ts` — glue and event wiring only

---

Last updated: 2026-04-09
