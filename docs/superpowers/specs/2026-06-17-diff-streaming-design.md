# Live Concurrent Diff Streaming — Design Spec

- **Date:** 2026-06-17
- **Status:** Approved (pending spec review)
- **Area:** Customization pipeline — `Customization/hooks/diff_daemon.py`, `Customization/runner.py`, `Connector/src/lib/customize-context.tsx`

## 1. Problem

During the customization execute phase, the agent makes edits via the `Edit`
tool. A `PreToolUse` hook (`Customization/hooks/diff_hook.sh`) streams each edit
into the diff daemon, which **accumulates** hunks per file in memory. Nothing is
surfaced to the UI while the agent works; the runner only drains the daemon
(`get_state`) in `_flush_remaining_edits()` **after** `_run_agent_phase("execute")`
returns, then presents diffs one-by-one for approval.

Result: a long period of no visible progress, followed by a burst of diff boxes.
The diffs already exist in the daemon during execute — they are simply withheld
until the phase ends.

## 2. Goals / Non-goals

**Goals**
- Surface each file's diff to the UI as soon as the agent makes the edit.
- Let the user approve/reject diffs concurrently while the agent keeps working.
- Never block the agent; never tell the agent the approval outcome.
- Keep filesystem mutation (rollback) deferred and safe.
- Bound the post-execute wait so the runner can never hang forever.
- Never let a user approve stale content.

**Non-goals (out of scope)**
- Reviewing `Write`/`bash`/`mv`/`rm` mutations as diffs (the `Edit`-only hook
  coverage gap, tracked separately as item "(c)").
- Changing how the builder phase's edits are handled (builder edits are not
  streamed/reviewed).
- Immediate (mid-run) rollback.

## 3. Approved decisions

- Live diff visibility during execute.
- One evolving diff box **per file**.
- Re-edits update the existing box (coalesced via existing merge logic).
- Concurrent user decisions.
- Delivery: **runner polls the daemon** via a new non-destructive `peek` API.
- **Deferred rollback** — decisions collected live, filesystem mutation applied
  after execute.
- Agent never blocked.
- Agent never sees approval decisions (out-of-band).
- Undecided diffs require an explicit decision before finalization.
- **Finalize timeout / escape hatch** (bounded wait).
- **Authoritative final peek** enforcing a decision-validity invariant.

## 4. Architecture

| Layer | Today | Change |
|---|---|---|
| **Daemon** (`diff_daemon.py`) | Accumulates hunks per file; `get_state` drains + resets | Add per-file revision counter; add non-destructive `peek`; keep `get_state`/`reset` for the final drain |
| **Runner** (`runner.py`) | `_flush_remaining_edits` runs after execute, prompts one-by-one | Background **poller** streams diffs live during execute; per-file decision tracking; **finalize** step applies decisions, waits for the invariant, bounded by a timeout |
| **Frontend** (`customize-context.tsx`) | Single `currentDiff`, blocking `waiting_diff` | Collection of concurrent boxes keyed by stable id; upsert/re-open in place; review during `executing`; new `awaiting_decisions` status |

The daemon's socket server is single-connection serialized, so `peek` and
`handle_edit` never run concurrently — no locking is required.

## 5. Daemon changes (`diff_daemon.py`)

- Add `_file_rev: dict[str, int]`. Bump `_file_rev[file_path]` on every
  `handle_edit` for that file (starting at 1).
- New action **`peek`**: returns
  `{"files": [{"file_path", "hunks", "backup", "rev"}, ...]}` for **all
  currently tracked files**, **without** resetting `_files`/`_file_backups`/`_file_rev`.
  - Hunk **merging stays in the runner** (`_merge_overlapping_hunks`) — `peek`
    returns the raw accumulated hunks plus the current `rev`, keeping the daemon
    change minimal.
- `get_state` (destructive drain) and `reset` are unchanged. `get_state` is used
  only as a finalize fallback; `reset` is used to clear state after finalization.

## 6. Runner changes (`runner.py`)

### 6.1 Stable id and per-file tracking

- `diff_id = md5(file_path)` — stable per file, so the frontend updates one box.
- Runner keeps a per-file record keyed by `diff_id`:
  `{file_path, backup, last_sent_rev, decision, decided_at_rev}`
  where `decision ∈ {None, "approved", "rejected"}`.

### 6.2 Poller (background task during execute)

Started alongside the execute exec-stream; interval ~0.7s. Each tick:
1. `peek` the daemon.
2. For each file with `rev > last_sent_rev`:
   - Merge hunks (`_hunk_sort_key` + `_merge_overlapping_hunks`).
   - Send `diff_preview {diff_id, file_path, hunks, rev}` (upsert on the
     frontend). `rev` is echoed back on decision (see §6.3).
   - Set `last_sent_rev = rev`.
   - **Re-open rule:** if the file already had a `decision` and
     `rev > decided_at_rev`, clear the decision (a re-edit after a decision
     returns the box to pending).
3. A failed poll is logged and retried next tick; it never blocks the agent.

### 6.3 Decisions (out-of-band)

`receive_diff_response(diff_id, approved, rev)` records `decision` and
`decided_at_rev = rev` — the rev the user **actually reviewed**, echoed back from
the `diff_preview`, *not* the runner's latest `last_sent_rev`. This closes a
race: if a concurrent re-edit advanced the file's rev between the box being shown
and the user clicking, the decision is recorded against the older (seen) rev, so
the §6.4 invariant fails and the box is re-opened against the new content. The
agent is never notified.

### 6.4 Decision-validity invariant (load-bearing)

> At finalize time, for every tracked file: `decision != None` **and**
> `decided_at_rev == current_rev`.

Any file failing this — no decision, or a decision made against an older rev —
is re-surfaced as pending. This single rule covers both "undecided must be
decided" and "cannot approve stale content."

### 6.5 Finalize (replaces `_flush_remaining_edits`, runs after execute exits)

1. **Stop the poller.**
2. **Authoritative final peek.** Because the agent process (the only source of
   `Edit` hooks) has exited, the filesystem is frozen; this peek captures every
   revision, including edits made between the last poll tick and execute exit.
   Apply §6.2 step 2 logic so newly-seen revs are sent and stale decisions are
   re-opened.
3. **Wait until the §6.4 invariant holds for all tracked files**, bounded by the
   timeout in §8. Status = `awaiting_decisions`; the frontend surfaces the
   remaining pending boxes.
4. **Apply decisions** (deferred rollback):
   - `rejected` → `cp -p <backup> <file>` (preserve pre-edit mtime so
     `_extract_changes` does not re-promote the restored file).
   - `approved` → keep current content.
5. `reset` the daemon and `rm` the backups.
6. Proceed to extraction (local) / builder / save.

## 7. Frontend changes (`customize-context.tsx`)

- Replace `currentDiff: DiffPreview | null` with `pendingDiffs` keyed by
  `diff_id`.
- `diff_preview` handler: **upsert** by `diff_id` (update hunks in place if the
  box exists). If a `diff_preview` arrives for a box already decided, reset it to
  `pending` (re-open) — the runner drives this on re-edit.
- Each box renders its own approve/reject; multiple can be pending at once;
  reviewed during the `executing` phase. `diff_response` echoes the box's `rev`
  (`{diff_id, approved, rev}`) so the runner can validate the decision against
  what the user actually saw (§6.3).
- Add `awaiting_decisions` status. It drives an end-of-run prompt highlighting
  boxes that still need a decision before the run can finalize. The blocking
  single-diff `waiting_diff` gate is no longer used (replaced by per-box review
  during `executing` + `awaiting_decisions`); the enum value may remain for
  backward compatibility.
- `changesMade` continues to be driven by the backend `changes_made` flag (now
  filesystem-derived) plus approvals.

## 8. Finalize timeout / escape hatch

- Constant `AWAITING_DECISIONS_TIMEOUT_SECONDS` (default **1800** = 30 min;
  acceptable range 30–60 min).
- The timer is **activity-based**: it resets on every decision received during
  `awaiting_decisions`. Only sustained no-decision time triggers it.
- Scope: the timeout applies **only to the post-execute `awaiting_decisions`
  wait**. There is no timeout during execute (bounded by the agent's own
  runtime).
- On timeout, end the session **gracefully, treated as a cancel**:
  - Send a clear message + terminal status to the frontend.
  - Stop the agent/daemon; cancel the poller (no leaked tasks).
  - Leave `edited/` as-is; **no save, no partial rollback** — finalization
    requires a complete, valid decision set, so a timed-out session saves
    nothing. The user can start a new session.

## 9. End-to-end flow

```
execute starts -> poller + agent stream run concurrently
  agent edits A        -> daemon revA=1
  poll -> diff_preview(A)                         [box A pending]
  agent edits B        -> daemon revB=1
  poll -> diff_preview(B)                         [box B pending]
  user approves A      -> decision[A]=approved, decided_at_rev=1
  agent edits A again  -> daemon revA=2
  poll -> revA(2) > decided_at_rev(1) -> re-open + diff_preview(A)  [box A pending]
agent finishes execute
  stop poller
  AUTHORITATIVE FINAL PEEK -> catches any rev not yet sent; re-opens stale decisions
  invariant check: A, B still pending -> status awaiting_decisions -> wait
    (timeout resets on each decision; fires after 30 min idle -> graceful cancel)
  user decides all -> invariant holds
  apply: rejected -> cp -p backup ; approved -> keep
  reset daemon ; rm backups
-> extraction (local) / builder / save
```

## 10. Edge cases & error handling

- **Cancel/close mid-execute:** cancel the poller task (no leaks); skip finalize
  and rollback — leave files as-is (matches today's "close keeps files").
- **Agent finishes before any review:** all boxes undecided → `awaiting_decisions`
  waits for the full set (degrades gracefully to today's batch, but boxes
  appeared live during the run).
- **Idle in `awaiting_decisions`:** bounded by §8 timeout → graceful cancel.
- **Stale decision (rev advanced after approval):** §6.4 invariant re-opens the
  box; the user must re-decide against the latest content.
- **Daemon/peek failure:** poller logs and retries next tick; never blocks the
  agent. If `peek` is unavailable at finalize, fall back to a single `get_state`
  drain (today's path).
- **File edited then `rm`-ed during execute:** the box reflects the `Edit` only
  (the `rm` is invisible to the `Edit`-only hook); deletion still propagates via
  the extraction layer. Existing review-coverage gap — out of scope here, noted
  so it is not a surprise.

## 11. Testing

- **Daemon (pytest in container):** `peek` is non-destructive; `rev` bumps per
  edit; multiple files returned; raw hunks + rev shape correct.
- **Runner (pure-function extraction):** factor decision-tracking and the
  re-open / invariant logic into testable helpers (rev vs `decided_at_rev`);
  assert finalize waits until the invariant holds; rejected → `cp -p`; timeout
  path triggers graceful cancel.
- **Frontend:** upsert by `diff_id`; concurrent boxes; re-open on a
  post-decision edit; `awaiting_decisions` prompt.
- **Integration (real container):** diffs appear during execute; re-edit
  re-opens; an edit made just before execute exit is caught by the final peek and
  blocks finalize until decided.

## 12. Affected files

- `Customization/hooks/diff_daemon.py` — `_file_rev`, `peek` action.
- `Customization/runner.py` — poller, per-file decision tracking, re-open rule,
  invariant, finalize (replaces `_flush_remaining_edits`), timeout.
- `Customization/models.py` — add `awaiting_decisions` to `StreamStatus`.
- `Connector/src/lib/customize-context.tsx` — `pendingDiffs`, upsert/re-open,
  status handling.
- Connector diff-rendering component(s) — render multiple concurrent boxes.
