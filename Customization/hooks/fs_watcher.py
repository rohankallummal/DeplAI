#!/usr/bin/env python3
"""Real-time filesystem watcher for the customize edited/ tree.

Uses raw Linux inotify via ctypes (no third-party deps) to stream
create / delete / rename events for files AND directories as they happen.
Directories created after startup get watches added on the fly, so files
written into a brand-new folder are still reported. Events are buffered in
chronological order and served over a unix socket for the runner to drain.
"""
import ctypes
import ctypes.util
import json
import os
import re
import signal
import socket
import struct
import sys
import threading

BASE = "/workspace/work"
SOCK_PATH = os.path.join(BASE, "fsevents.sock")

IN_CREATE = 0x00000100
IN_DELETE = 0x00000200
IN_MOVED_FROM = 0x00000040
IN_MOVED_TO = 0x00000080
IN_DELETE_SELF = 0x00000400
IN_MOVE_SELF = 0x00000800
IN_ISDIR = 0x40000000
IN_IGNORED = 0x00008000

WATCH_MASK = IN_CREATE | IN_DELETE | IN_MOVED_FROM | IN_MOVED_TO | IN_DELETE_SELF | IN_MOVE_SELF

EXCLUDE_DIRS = {
    "node_modules", ".next", "dist", "build", ".cache",
    "__pycache__", ".venv", "venv", ".turbo", ".swc", ".git",
}

# Atomic-write temp files, e.g. "analytics.css.tmp.139.4036a301c7c7": the agent's
# Write tool writes one then renames it onto the real path. Dropping the temp
# create and the temp side of the rename leaves the rename's real destination to
# surface as a single "created" event, instead of a noisy create-temp + rename.
_TMP_RE = re.compile(r"\.tmp\.\d+\.[0-9a-fA-F]+$")

_HDR = struct.Struct("iIII")  # wd, mask, cookie, name_len

_libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6", use_errno=True)
_libc.inotify_init.argtypes = []
_libc.inotify_init.restype = ctypes.c_int
_libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
_libc.inotify_add_watch.restype = ctypes.c_int


class Watcher:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self.fd = _libc.inotify_init()
        if self.fd < 0:
            raise OSError(ctypes.get_errno(), "inotify_init failed")
        self.wd_path: dict[int, str] = {}
        self.events: list[dict] = []
        self.seq = 0
        self.lock = threading.Lock()
        # Paths that already exist, so a later create/rename onto one is recognized
        # as a modification of a pre-existing file (already shown by its diff box)
        # rather than a spurious "created" event.
        self.known: set[str] = set()
        self._add_recursive(self.root)
        self._seed_known()

    def _excluded(self, path: str) -> bool:
        rel = os.path.relpath(path, self.root)
        if rel == ".":
            return False
        return any(part in EXCLUDE_DIRS for part in rel.split(os.sep))

    def _add_watch(self, path: str) -> None:
        if self._excluded(path):
            return
        wd = _libc.inotify_add_watch(self.fd, path.encode(), WATCH_MASK)
        if wd >= 0:
            self.wd_path[wd] = path

    def _add_recursive(self, path: str) -> None:
        if not os.path.isdir(path):
            return
        self._add_watch(path)
        for dirpath, dirnames, _files in os.walk(path):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for d in dirnames:
                self._add_watch(os.path.join(dirpath, d))

    def _rel(self, path: str) -> str:
        return os.path.relpath(path, self.root)

    def _is_temp(self, path: str) -> bool:
        return bool(_TMP_RE.search(os.path.basename(path)))

    def _seed_known(self) -> None:
        """Record every file and directory present at startup. Runtime watches
        added for newly-created directories deliberately do NOT seed known, so
        files written into a brand-new folder still report as created."""
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            self.known.add(dirpath)
            for f in filenames:
                self.known.add(os.path.join(dirpath, f))

    def _push(self, ev: dict) -> None:
        with self.lock:
            self.seq += 1
            ev["seq"] = self.seq
            self.events.append(ev)

    def drain(self) -> list[dict]:
        with self.lock:
            out, self.events = self.events, []
            return out

    def reset(self) -> None:
        with self.lock:
            self.events = []

    def _kind(self, mask: int) -> str:
        return "folder" if mask & IN_ISDIR else "file"

    def run(self) -> None:
        while True:
            try:
                buf = os.read(self.fd, 65536)
            except OSError:
                continue
            self._process(buf)

    def _process(self, buf: bytes) -> None:
        i, n = 0, len(buf)
        pending_from: dict[int, tuple[str, int]] = {}
        batch: list[tuple[int, int, str, int]] = []  # mask, cookie, path, wd
        while i + _HDR.size <= n:
            wd, mask, cookie, length = _HDR.unpack_from(buf, i)
            i += _HDR.size
            name = buf[i:i + length].split(b"\x00", 1)[0].decode("utf-8", "replace")
            i += length
            # Watch teardown bookkeeping: the kernel auto-removes the watch.
            if mask & (IN_IGNORED | IN_DELETE_SELF | IN_MOVE_SELF):
                self.wd_path.pop(wd, None)
                if mask & IN_IGNORED:
                    continue
            base = self.wd_path.get(wd)
            if base is None:
                continue
            path = os.path.join(base, name) if name else base
            if self._excluded(path):
                continue
            # Drop atomic-write temp files. Skipping the temp MOVED_FROM leaves its
            # paired MOVED_TO (the real file) with no source, so it is reported as a
            # plain "created" below — one clean notice per written file.
            if self._is_temp(path):
                continue
            batch.append((mask, cookie, path, wd))

        for mask, cookie, path, _wd in batch:
            if mask & IN_CREATE:
                if mask & IN_ISDIR:
                    self._add_recursive(path)
                self._emit_appearance(mask, path)
            elif mask & IN_DELETE:
                self.known.discard(path)
                self._push({"action": "deleted", "kind": self._kind(mask), "path": self._rel(path)})
            elif mask & IN_MOVED_FROM:
                pending_from[cookie] = (path, mask)
            elif mask & IN_MOVED_TO:
                src = pending_from.pop(cookie, None)
                if mask & IN_ISDIR:
                    self._add_recursive(path)
                if src is not None:
                    # Genuine rename within the tree.
                    self.known.discard(src[0])
                    self.known.add(path)
                    self._push({"action": "renamed", "kind": self._kind(mask),
                                "from": self._rel(src[0]), "to": self._rel(path),
                                "path": self._rel(path)})
                else:
                    # Appeared via rename with no in-tree source — e.g. an atomic
                    # write (temp dropped above). New path => created; known path =>
                    # an edit/overwrite of an existing file, shown by its diff box.
                    self._emit_appearance(mask, path)

        # A MOVED_FROM with no MOVED_TO in this batch == moved out of the tree.
        for path, mask in pending_from.values():
            self.known.discard(path)
            self._push({"action": "deleted", "kind": self._kind(mask), "path": self._rel(path)})

    def _emit_appearance(self, mask: int, path: str) -> None:
        """A file/dir appeared at path. Report it as "created" only if the path is
        new; a path that already existed is a modification of an existing file
        (represented by its diff box), so it is not surfaced as a file event."""
        if path in self.known:
            return
        self.known.add(path)
        self._push({"action": "created", "kind": self._kind(mask), "path": self._rel(path)})


def serve(watcher: Watcher) -> None:
    os.makedirs(BASE, exist_ok=True)
    try:
        os.remove(SOCK_PATH)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCK_PATH)
    os.chmod(SOCK_PATH, 0o777)
    server.listen(5)

    def shutdown(_signum, _frame):
        server.close()
        try:
            os.remove(SOCK_PATH)
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    while True:
        conn, _ = server.accept()
        try:
            chunks: list[bytes] = []
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                chunks.append(chunk)
            raw = b"".join(chunks)
            action = json.loads(raw).get("action") if raw else None
            if action == "drain":
                conn.sendall(json.dumps({"events": watcher.drain()}).encode())
            elif action == "reset":
                watcher.reset()
                conn.sendall(b'{"status":"ok"}')
            else:
                conn.sendall(b'{"status":"ok"}')
        except Exception:
            try:
                conn.sendall(b'{"events":[]}')
            except Exception:
                pass
        finally:
            conn.close()


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    w = Watcher(root)
    threading.Thread(target=w.run, daemon=True).start()
    serve(w)
