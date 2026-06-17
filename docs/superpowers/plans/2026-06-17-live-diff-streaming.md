# Live Concurrent Diff Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream each file's diff to the UI live as the agent edits during the execute phase, let the user approve/reject concurrently while the agent keeps working, and apply rejections (rollback) once after execute — bounded by a decision timeout.

**Architecture:** The in-container diff daemon gains a per-file revision counter and a non-destructive `peek` action. The runner runs a background poller during execute that pushes `diff_preview` messages live and tracks per-file decisions in a small pure-Python state module (`diff_state.py`). After execute exits, a `finalize` step takes an authoritative final peek, waits (with timeout) until every file is decided against its latest revision, then applies rollbacks. The frontend upserts diff boxes by id.

**Tech Stack:** Python 3.12 (FastAPI runner, stdlib socket daemon), Docker (alpine/busybox exec), Next.js/React + TypeScript (Connector frontend).

**Spec:** `docs/superpowers/specs/2026-06-17-diff-streaming-design.md`

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `Customization/hooks/diff_daemon.py` | Accumulate per-file hunks + revisions; serve `peek`/`get_state`/`reset` | Modify |
| `Customization/diff_state.py` | Pure per-file decision tracking (no I/O) — the re-open + invariant logic | Create |
| `Customization/runner.py` | Poller, finalize, decision routing, pipeline integration | Modify |
| `Customization/models.py` | `StreamStatus.awaiting_decisions` | Modify |
| `Customization/main.py` | Route `rev` on `diff_response`; mark `awaiting_decisions` active | Modify |
| `Customization/tests/test_diff_daemon.py` | Daemon unit tests | Create |
| `Customization/tests/test_diff_state.py` | Decision-tracking unit tests | Create |
| `Connector/src/lib/customize-context.tsx` | Upsert diff boxes by id; `rev` echo; new status | Modify |
| `Connector/src/app/webpages/codeview/chat-interface.tsx` | Pass `rev` on decisions; `awaiting_decisions` banner | Modify |

**Test command (Python, run from repo root).** Python only runs in a container here. On Windows Git Bash prefix with `MSYS_NO_PATHCONV=1` and use `/r/PES/PVL/DeplAI/...` paths:

```bash
docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim \
  sh -c "pip install -q pytest && python -m pytest tests/ -v"
```

**Frontend verify command** (per repo convention — `npm run lint` is too noisy):

```bash
cd Connector && npx tsc --noEmit && npx eslint src/lib/customize-context.tsx src/app/webpages/codeview/chat-interface.tsx
```

---

## Task 1: Daemon — per-file revisions + non-destructive `peek`

**Files:**
- Modify: `Customization/hooks/diff_daemon.py`
- Test: `Customization/tests/test_diff_daemon.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `Customization/tests/test_diff_daemon.py`:

```python
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))
import diff_daemon as dd  # noqa: E402


def _reset_globals():
    dd._files = {}
    dd._file_backups = {}
    dd._file_rev = {}


def test_peek_is_nondestructive_and_includes_rev():
    _reset_globals()
    dd._files = {"/w/a.ts": [{"lines": [{"type": "add", "num": 1, "text": "x"}]}]}
    dd._file_backups = {"/w/a.ts": "/bk/a"}
    dd._file_rev = {"/w/a.ts": 3}

    state = dd.handle_peek()

    assert state["files"] == [{
        "file_path": "/w/a.ts",
        "hunks": [{"lines": [{"type": "add", "num": 1, "text": "x"}]}],
        "backup": "/bk/a",
        "rev": 3,
    }]
    # peek must NOT clear state
    assert dd._files != {}
    assert dd._file_rev == {"/w/a.ts": 3}


def test_get_state_drains_including_rev():
    _reset_globals()
    dd._files = {"/w/a.ts": []}
    dd._file_rev = {"/w/a.ts": 1}
    dd.handle_get_state()
    assert dd._files == {}
    assert dd._file_rev == {}


def test_reset_clears_rev():
    _reset_globals()
    dd._file_rev = {"/w/a.ts": 2}
    dd.handle_reset()
    assert dd._file_rev == {}


def test_handle_edit_bumps_rev_per_file(tmp_path, monkeypatch):
    _reset_globals()
    monkeypatch.setattr(dd, "BACKUPS_DIR", str(tmp_path / "backups"))
    f = tmp_path / "a.ts"
    f.write_text("line1\nold\nline3\n")
    payload = {"tool_input": {"file_path": str(f), "old_string": "old", "new_string": "new"}}

    dd.handle_edit(payload)
    dd.handle_edit(payload)

    assert dd._file_rev[str(f)] == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim sh -c "pip install -q pytest && python -m pytest tests/test_diff_daemon.py -v"`
Expected: FAIL — `AttributeError: module ... has no attribute 'handle_peek'` / `'_file_rev'`.

- [ ] **Step 3: Add `_file_rev`, bump it in `handle_edit`, add `handle_peek`, clear it in `handle_get_state`/`handle_reset`, and dispatch `peek`**

In `Customization/hooks/diff_daemon.py`:

Add the global next to the others:

```python
_files: dict[str, list] = {}
_file_backups: dict[str, str] = {}
_file_rev: dict[str, int] = {}
```

In `handle_edit`, bump the revision right after appending the hunk:

```python
    hunk = build_hunk(file_path, old_string, new_string)
    _files[file_path].append(hunk)
    _file_rev[file_path] = _file_rev.get(file_path, 0) + 1
```

Add `handle_peek` (non-destructive) next to `handle_get_state`:

```python
def handle_peek() -> dict:
    return {
        "files": [
            {
                "file_path": fp,
                "hunks": hunks,
                "backup": _file_backups.get(fp),
                "rev": _file_rev.get(fp, 0),
            }
            for fp, hunks in _files.items()
        ],
    }
```

In `handle_get_state`, also clear `_file_rev`:

```python
def handle_get_state() -> dict:
    global _files, _file_backups, _file_rev
    state = {
        "files": [
            {"file_path": fp, "hunks": hunks, "backup": _file_backups.get(fp)}
            for fp, hunks in _files.items()
        ],
    }
    _files = {}
    _file_backups = {}
    _file_rev = {}
    return state
```

In `handle_reset`, also clear `_file_rev`:

```python
def handle_reset() -> None:
    global _files, _file_backups, _file_rev
    _files = {}
    _file_backups = {}
    _file_rev = {}
```

In `run_server`, add a `peek` branch before the `get_state` branch:

```python
            if action == "peek":
                state = handle_peek()
                conn.sendall(json.dumps(state).encode())
            elif action == "get_state":
                state = handle_get_state()
                conn.sendall(json.dumps(state).encode())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim sh -c "pip install -q pytest && python -m pytest tests/test_diff_daemon.py -v"`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add Customization/hooks/diff_daemon.py Customization/tests/test_diff_daemon.py
git commit -m "feat(diff): add per-file revisions and non-destructive peek to diff daemon"
```

---

## Task 2: `diff_state.py` — pure decision tracking

**Files:**
- Create: `Customization/diff_state.py`
- Test: `Customization/tests/test_diff_state.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `Customization/tests/test_diff_state.py`:

```python
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from diff_state import DiffTracker, diff_id_for  # noqa: E402


def test_reconcile_sends_once_per_new_rev():
    t = DiffTracker()
    assert t.reconcile("/w/a.ts", 1, "/bk/a") is True   # first edit -> send
    assert t.reconcile("/w/a.ts", 1, "/bk/a") is False  # same rev -> no resend
    assert t.reconcile("/w/a.ts", 2, "/bk/a") is True   # new rev -> send


def test_decision_settles_only_at_latest_rev():
    t = DiffTracker()
    did = diff_id_for("/w/a.ts")
    t.reconcile("/w/a.ts", 1, "/bk/a")
    t.record_decision(did, True, 1)
    assert t.has_unsettled() is False           # decided at the rev shown

    # concurrent re-edit advances the file
    t.reconcile("/w/a.ts", 2, "/bk/a")
    assert t.has_unsettled() is True            # decision now stale -> re-opened
    assert t.records[did].decision is None


def test_stale_decision_against_old_rev_stays_unsettled():
    t = DiffTracker()
    did = diff_id_for("/w/a.ts")
    t.reconcile("/w/a.ts", 2, "/bk/a")          # latest sent rev is 2
    t.record_decision(did, True, 1)             # user decided against rev 1
    assert t.has_unsettled() is True            # invariant fails: 1 != 2


def test_backup_is_retained_from_first_sight():
    t = DiffTracker()
    did = diff_id_for("/w/a.ts")
    t.reconcile("/w/a.ts", 1, "/bk/a")
    t.reconcile("/w/a.ts", 2, None)             # later peek lacks backup
    assert t.records[did].backup == "/bk/a"


def test_reset_clears_records():
    t = DiffTracker()
    t.reconcile("/w/a.ts", 1, "/bk/a")
    t.reset()
    assert t.records == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim sh -c "pip install -q pytest && python -m pytest tests/test_diff_state.py -v"`
Expected: FAIL — `ModuleNotFoundError: No module named 'diff_state'`.

- [ ] **Step 3: Implement `diff_state.py`**

Create `Customization/diff_state.py`:

```python
"""Pure per-file decision tracking for live diff streaming.

No I/O and no framework imports, so it is unit-testable in isolation. The runner
holds one DiffTracker per execute iteration.

Invariant (a file is "settled"): it has a decision AND that decision was made
against the latest revision the runner sent (decided_at_rev == last_sent_rev).
After the authoritative final peek, last_sent_rev equals the daemon's current
rev, so a settled file's decision matches its final content.
"""

import hashlib
from dataclasses import dataclass


def diff_id_for(file_path: str) -> str:
    """Stable per-file id so the frontend updates one box across re-edits."""
    return hashlib.md5(file_path.encode()).hexdigest()


@dataclass
class DiffRecord:
    file_path: str
    backup: str | None = None
    last_sent_rev: int = 0
    decision: str | None = None        # None | "approved" | "rejected"
    decided_at_rev: int | None = None


class DiffTracker:
    def __init__(self) -> None:
        self.records: dict[str, DiffRecord] = {}

    def reconcile(self, file_path: str, rev: int, backup: str | None) -> bool:
        """Fold a peeked file into state. Return True if the runner should
        (re)send a diff_preview for it — i.e. its revision advanced past what was
        last sent. A decided record whose content has since changed is re-opened.
        """
        did = diff_id_for(file_path)
        rec = self.records.get(did)
        if rec is None:
            rec = DiffRecord(file_path=file_path)
            self.records[did] = rec
        if backup and not rec.backup:
            rec.backup = backup
        if rev <= rec.last_sent_rev:
            return False
        if rec.decision is not None and rev > (rec.decided_at_rev or 0):
            rec.decision = None
            rec.decided_at_rev = None
        rec.last_sent_rev = rev
        return True

    def record_decision(self, diff_id: str, approved: bool, rev: int) -> None:
        """Record a user's decision against the rev they actually reviewed."""
        rec = self.records.get(diff_id)
        if rec is None:
            return
        rec.decision = "approved" if approved else "rejected"
        rec.decided_at_rev = rev

    def is_settled(self, rec: DiffRecord) -> bool:
        return rec.decision is not None and rec.decided_at_rev == rec.last_sent_rev

    def has_unsettled(self) -> bool:
        return any(not self.is_settled(r) for r in self.records.values())

    def reset(self) -> None:
        self.records = {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim sh -c "pip install -q pytest && python -m pytest tests/test_diff_state.py -v"`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add Customization/diff_state.py Customization/tests/test_diff_state.py
git commit -m "feat(diff): add pure DiffTracker decision-state module"
```

---

## Task 3: Backend wiring — `awaiting_decisions` status + `rev` routing

**Files:**
- Modify: `Customization/models.py:30-39`
- Modify: `Customization/main.py:41` and `Customization/main.py:109-113`

- [ ] **Step 1: Add the status enum value**

In `Customization/models.py`, add to `StreamStatus`:

```python
class StreamStatus(str, Enum):
    running = "running"
    preparing = "preparing"
    executing = "executing"
    waiting_diff = "waiting_diff"
    awaiting_decisions = "awaiting_decisions"
    building = "building"
    build_fixing = "build_fixing"
    completed = "completed"
    saving = "saving"
    error = "error"
```

- [ ] **Step 2: Mark it active and route `rev`**

In `Customization/main.py`, add `awaiting_decisions` to `ACTIVE_STATUSES`:

```python
ACTIVE_STATUSES = frozenset({
    "running", "executing", "waiting_diff", "awaiting_decisions",
    "building", "build_fixing", "saving",
})
```

And pass `rev` through on `diff_response`:

```python
                elif cmd.action == "diff_response" and cmd.data:
                    await runner.receive_diff_response(
                        cmd.data.get("diff_id", ""),
                        cmd.data.get("approved", False),
                        cmd.data.get("rev", 0),
                    )
```

- [ ] **Step 3: Verify it imports cleanly**

Run: `docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim python -c "import ast; ast.parse(open('models.py').read()); ast.parse(open('main.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add Customization/models.py Customization/main.py
git commit -m "feat(diff): add awaiting_decisions status and route diff rev"
```

---

## Task 4: Runner — poller, finalize, decision routing, pipeline integration

**Files:**
- Modify: `Customization/runner.py` (imports/constants ~1-23; `__init__` ~27-44; `cancel` ~56-69; `receive_diff_response` ~75-77; the `_run_pipeline` execute block ~155-196; remove `_handle_diff_approval` and `_flush_remaining_edits` ~184-272; keep `_hunk_sort_key`/`_merge_overlapping_hunks`)

This task is integration code against the live container; it is verified by Task 7's end-to-end run plus the unit-tested helpers from Tasks 1-2.

- [ ] **Step 1: Add imports + constants**

At the top of `Customization/runner.py`, remove the now-unused `import uuid`, and add:

```python
from diff_state import DiffTracker, diff_id_for
```

Add module-level constants near `TOTAL_STEPS = 8`:

```python
DIFF_POLL_INTERVAL_SECONDS = 0.7
# Bounded escape hatch: how long finalize waits for the user to decide remaining
# diffs before ending the session without saving. Resets on each decision.
AWAITING_DECISIONS_TIMEOUT_SECONDS = 1800  # 30 min
```

- [ ] **Step 2: Replace the diff state fields in `__init__`**

In `CustomizationRunner.__init__`, replace:

```python
        self._diff_response_event = asyncio.Event()
        self._diff_response_data: dict | None = None
```

with:

```python
        self._diffs = DiffTracker()
        self._decision_event = asyncio.Event()
```

- [ ] **Step 3: Update `cancel` to wake the decision wait**

In `cancel`, replace `self._diff_response_event.set()` with:

```python
        self._decision_event.set()
```

- [ ] **Step 4: Rewrite `receive_diff_response`**

Replace the existing `receive_diff_response` with:

```python
    async def receive_diff_response(self, diff_id: str, approved: bool, rev: int = 0):
        # Out-of-band: recorded against the rev the user actually reviewed, so a
        # concurrent re-edit re-opens the box instead of approving stale content.
        self._diffs.record_decision(diff_id, approved, rev)
        self._decision_event.set()
```

- [ ] **Step 5: Add the poller and peek helpers**

Add these methods to `CustomizationRunner` (e.g. just above `_run_builder`):

```python
    async def _peek_daemon(self) -> dict | None:
        ec, output = await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "printf '{\"action\":\"peek\"}' | "
                "socat -t5 - UNIX-CONNECT:/workspace/work/hook.sock 2>/dev/null",
            ],
            user="agent",
        )
        if ec != 0:
            return None
        try:
            return json.loads(decode_output(output))
        except json.JSONDecodeError:
            return None

    async def _emit_pending_diffs(self):
        state = await self._peek_daemon()
        if not state:
            return
        for f in state.get("files", []):
            file_path = f.get("file_path", "")
            hunks = f.get("hunks", [])
            rev = f.get("rev", 0)
            backup = f.get("backup")
            if not file_path or not hunks:
                continue
            if not self._diffs.reconcile(file_path, rev, backup):
                continue
            hunks = sorted(hunks, key=self._hunk_sort_key)
            hunks = self._merge_overlapping_hunks(hunks)
            await self._try_send({
                "type": "diff_preview",
                "data": {
                    "diff_id": diff_id_for(file_path),
                    "file_path": file_path,
                    "hunks": hunks,
                    "rev": rev,
                },
            })

    async def _poll_diffs(self):
        while not self._cancelled:
            try:
                await self._emit_pending_diffs()
            except Exception as e:
                logger.debug("diff poll error: %s", e)
            await asyncio.sleep(DIFF_POLL_INTERVAL_SECONDS)
```

- [ ] **Step 6: Replace `_flush_remaining_edits` and `_handle_diff_approval` with `_finalize_diffs`**

Delete the `_handle_diff_approval` and `_flush_remaining_edits` methods. Keep `_hunk_sort_key` and `_merge_overlapping_hunks` (the poller uses them). Add:

```python
    async def _finalize_diffs(self):
        """After execute exits the agent is the only edit source, so the
        filesystem is frozen. Take an authoritative final peek, wait until every
        file is settled (decided at its latest rev) bounded by a timeout, then
        apply rollbacks for rejected files and drain the daemon."""
        if self._cancelled:
            return

        await self._emit_pending_diffs()  # authoritative final peek

        if self._diffs.has_unsettled():
            await self._send_status(StreamStatus.awaiting_decisions)
        while not self._cancelled:
            self._decision_event.clear()
            if not self._diffs.has_unsettled():
                break
            try:
                await asyncio.wait_for(
                    self._decision_event.wait(),
                    timeout=AWAITING_DECISIONS_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                logger.warning("Awaiting-decisions timed out for %s; ending session", self.project_id)
                await self._try_send({
                    "type": "error",
                    "data": "Review timed out — the session was closed without saving. Please start again.",
                })
                await self._send_status(StreamStatus.error)
                self.cancel()
                return

        if self._cancelled:
            return

        for rec in self._diffs.records.values():
            if rec.decision == "approved":
                self._changes_made = True
                self._iteration_changes_made = True
            elif rec.decision == "rejected" and rec.backup:
                # -p preserves the pre-edit mtime so _extract_changes does not
                # re-promote a rejected file.
                await asyncio.to_thread(
                    self._container.exec_run,
                    ["sh", "-c", f"cp -p '{rec.backup}' '{rec.file_path}'"],
                    user="agent",
                )

        await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "printf '{\"action\":\"reset\"}' | "
                "socat -t5 - UNIX-CONNECT:/workspace/work/hook.sock 2>/dev/null; "
                "rm -rf /workspace/work/backups",
            ],
            user="agent",
        )
        self._diffs.reset()
```

- [ ] **Step 7: Wire the poller + finalize into `_run_pipeline`**

Replace the execute block. Change:

```python
            execute_result = await self._run_agent_phase(
                "execute",
                extra_args=["--user-request", prompt],
            )
            await self._flush_remaining_edits()
```

to:

```python
            self._diffs.reset()
            poller = asyncio.create_task(self._poll_diffs())
            try:
                execute_result = await self._run_agent_phase(
                    "execute",
                    extra_args=["--user-request", prompt],
                )
            finally:
                poller.cancel()
                try:
                    await poller
                except asyncio.CancelledError:
                    pass

            await self._finalize_diffs()
            if self._cancelled:
                return
```

The block that follows (the `iteration_changed = self._iteration_changes_made`
extraction logic, the failure check, and the builder) is unchanged — finalize
now sets `_changes_made`/`_iteration_changes_made` on approvals, exactly where
`_handle_diff_approval` used to.

- [ ] **Step 8: Verify it parses and that removed symbols are gone**

Run: `docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim python -c "import ast; ast.parse(open('runner.py').read()); print('OK')"`
Expected: `OK`

Run: `docker run --rm -v "/r/PES/PVL/DeplAI/Customization:/app" -w /app python:3.12-slim sh -c "grep -n '_flush_remaining_edits\|_handle_diff_approval\|_diff_response_event\|import uuid' runner.py || echo NONE_LEFT"`
Expected: `NONE_LEFT`

- [ ] **Step 9: Commit**

```bash
git add Customization/runner.py
git commit -m "feat(diff): stream diffs live via poller + finalize with deferred rollback"
```

---

## Task 5: Frontend context — upsert by id, `rev` echo, new status

**Files:**
- Modify: `Connector/src/lib/customize-context.tsx`

- [ ] **Step 1: Extend the types and status map**

Add `'awaiting_decisions'` to `CustomizePhase` (line 8):

```typescript
export type CustomizePhase = 'idle' | 'preparing' | 'executing' | 'waiting_diff' | 'awaiting_decisions' | 'building' | 'build_fixing' | 'completed' | 'error' | 'saving';
```

Add `rev` to `DiffPreview` (line 20-25):

```typescript
export interface DiffPreview {
  diff_id: string;
  file_path: string;
  hunks: DiffHunk[];
  rev: number;
  status: 'pending' | 'approved' | 'rejected';
}
```

Add the mapping in `STATUS_MAP` (line 82-92):

```typescript
  executing: 'executing',
  waiting_diff: 'waiting_diff',
  awaiting_decisions: 'awaiting_decisions',
```

- [ ] **Step 2: Upsert diff boxes by `diff_id` (re-open on re-edit)**

Replace the `diff_preview` case (line 148-157):

```typescript
        case 'diff_preview': {
          const incoming = data.data as Omit<DiffPreview, 'status'>;
          const diff: DiffPreview = { ...incoming, status: 'pending' };
          updateProject(projectId, existing => {
            const idx = existing.chatMessages.findIndex(
              m => m.type === 'diff' && m.diff?.diff_id === incoming.diff_id,
            );
            if (idx >= 0) {
              // Re-edit (or re-open): update the existing box in place.
              const chatMessages = existing.chatMessages.slice();
              chatMessages[idx] = { ...chatMessages[idx], diff };
              return { chatMessages };
            }
            return {
              chatMessages: [
                ...existing.chatMessages,
                { id: genId(), role: 'agent' as const, type: 'diff' as const, diff, timestamp: new Date().toISOString() },
              ],
            };
          });
          break;
        }
```

Note: this no longer forces `phase: 'waiting_diff'` or sets `currentDiff` — boxes are reviewed during `executing`/`awaiting_decisions`.

- [ ] **Step 3: Echo `rev` from `respondToDiff`**

Change the `respondToDiff` signature and body (line 279-297) to take and send `rev`:

```typescript
  const respondToDiff = useCallback((projectId: string, diffId: string, approved: boolean, rev: number) => {
    const ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    updateProject(projectId, existing => ({
      changesMade: existing.changesMade || approved,
      chatMessages: existing.chatMessages.map(msg =>
        msg.type === 'diff' && msg.diff?.diff_id === diffId
          ? { ...msg, diff: { ...msg.diff!, status: approved ? 'approved' as const : 'rejected' as const } }
          : msg
      ),
    }));

    ws.send(JSON.stringify({
      action: 'diff_response',
      data: { diff_id: diffId, approved, rev },
    }));
  }, []);
```

Update the interface signature (line 53):

```typescript
  respondToDiff: (projectId: string, diffId: string, approved: boolean, rev: number) => void;
```

Remove `currentDiff` from `ProjectCustomizeState` (line 44) and `DEFAULT_STATE` (line 73) — it is no longer read anywhere after Step 2 and Task 6.

- [ ] **Step 4: Verify types and lint**

Run: `cd Connector && npx tsc --noEmit && npx eslint src/lib/customize-context.tsx`
Expected: no errors. (`tsc` will flag the `respondToDiff` call site in `chat-interface.tsx` — fixed in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add Connector/src/lib/customize-context.tsx
git commit -m "feat(diff): upsert diff boxes by id and echo rev in respondToDiff"
```

---

## Task 6: Frontend chat UI — pass `rev`, awaiting-decisions banner

**Files:**
- Modify: `Connector/src/app/webpages/codeview/chat-interface.tsx`

- [ ] **Step 1: Pass `rev` on every decision**

Update the auto-approve loop (around line 209-211):

```typescript
      if (msg.type === 'diff' && msg.diff?.status === 'pending') {
        respondToDiff(projectId, msg.diff.diff_id, true, msg.diff.rev);
      }
```

Update the `ApprovalButtons` wiring (around line 301-304):

```typescript
                    <ApprovalButtons
                      onApprove={() => respondToDiff(projectId, msg.diff!.diff_id, true, msg.diff!.rev)}
                      onReject={() => respondToDiff(projectId, msg.diff!.diff_id, false, msg.diff!.rev)}
                    />
```

- [ ] **Step 2: Show an awaiting-decisions banner**

Find where `state.phase` drives status UI (search the file for `state.phase`). Add a banner shown when the agent has finished but decisions remain. Place it just before the messages list render (near line 283, inside the main column):

```tsx
{state.phase === 'awaiting_decisions' && (
  <div className="w-full rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-500">
    Review the remaining changes above — approve or reject each to finish.
  </div>
)}
```

- [ ] **Step 3: Verify types and lint**

Run: `cd Connector && npx tsc --noEmit && npx eslint src/app/webpages/codeview/chat-interface.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add Connector/src/app/webpages/codeview/chat-interface.tsx
git commit -m "feat(diff): pass rev on decisions and add awaiting-decisions banner"
```

---

## Task 7: End-to-end verification in the real container

**Files:** none (verification only)

- [ ] **Step 1: Rebuild/refresh the customize image so the daemon + runner changes are live**

Run the project's normal image build for `Customization` (e.g. `docker compose build customize` or the documented build step), then restart the customize service.

- [ ] **Step 2: Drive a multi-edit local customization and watch the stream**

Start a local-project customization that edits several files in one request. Confirm:
- Diff boxes appear **during** the execute phase (not all at the end), one per file, spaced by the agent's edit cadence.
- Approving/rejecting a box works while the agent is still editing other files.

Expected: live boxes; agent never blocks.

- [ ] **Step 2b: Confirm re-edit re-opens a decided box**

Issue a request that edits file X, then later edits X again in the same run. After you approve X's first box, confirm the box returns to **pending** when the second edit streams in (it must be re-decided).

Expected: the same box flips back to pending; deciding it again settles it.

- [ ] **Step 3: Confirm the final-peek + invariant gate**

End a run where the agent makes a final edit just before finishing. Confirm the run does not finalize until every box (including that last one) has an explicit decision; the phase shows `awaiting_decisions` while any remain.

Expected: finalize blocks on undecided/stale boxes; completes once all are decided.

- [ ] **Step 4: Confirm deferred rollback + save**

Reject one file, approve others, let it finish, and Save. Confirm the rejected file is reverted to its pre-session content in the saved project and approved files are present (uses the extraction + `cp -p` path).

Expected: rejected file reverted; approved files saved.

- [ ] **Step 5: Confirm the timeout escape hatch (optional, fast variant)**

Temporarily set `AWAITING_DECISIONS_TIMEOUT_SECONDS = 10` in `runner.py`, trigger `awaiting_decisions`, and walk away. Confirm the session ends gracefully with the timeout message and saves nothing. Restore the constant to `1800` afterward.

Expected: graceful timeout message; no save; constant restored.

- [ ] **Step 6: Final commit (if the constant or anything was touched during verification)**

```bash
git add -A
git commit -m "test(diff): verify live diff streaming end-to-end"
```

---

## Notes for the implementer

- **Out of scope** (do not build): reviewing `Write`/`bash`/`rm`/`mv` mutations as diffs; streaming builder-phase edits; immediate (mid-run) rollback. See spec §2/§10.
- The `waiting_diff` enum value is intentionally left in place for backward compatibility but is no longer driven by the backend.
- `_extract_changes` (already in `runner.py`) runs after `_finalize_diffs` and is the source of truth for what gets saved; finalize only collects approvals and rolls back rejections. Do not duplicate promotion logic in finalize.
