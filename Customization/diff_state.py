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
