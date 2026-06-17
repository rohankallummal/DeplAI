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
