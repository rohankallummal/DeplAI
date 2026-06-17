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
    # peek must NOT clear state (pin exact content, not just non-emptiness)
    assert dd._files == {"/w/a.ts": [{"lines": [{"type": "add", "num": 1, "text": "x"}]}]}
    assert dd._file_backups == {"/w/a.ts": "/bk/a"}
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
