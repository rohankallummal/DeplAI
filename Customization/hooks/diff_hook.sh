#!/bin/bash
# PreToolUse hook for Edit tool — file-level approval.
# Accumulates edits per file. Blocks on file transitions to get
# approval for the *previous* file's collected hunks.
# Exit 0 = allow edit (always, so the agent keeps flowing).

python3 -c "
import sys, json, uuid, time, os, shutil

BASE = '/workspace/customize'
ACCUMULATOR  = os.path.join(BASE, 'edit_accumulator.json')
CURRENT_FILE = os.path.join(BASE, 'current_edit_file.txt')
FILE_BACKUP  = os.path.join(BASE, 'file_backup')
PENDING      = os.path.join(BASE, 'pending_diff.json')
RESPONSE     = os.path.join(BASE, 'diff_response.json')
TIMEOUT = 300
CONTEXT = 3

os.makedirs(BASE, exist_ok=True)

data = json.load(sys.stdin)
tool_input = data.get('tool_input', data)

file_path  = tool_input.get('file_path', '')
old_string = tool_input.get('old_string', '')
new_string = tool_input.get('new_string', '')

# ── helpers ───────────────────────────────────────────────────────

def build_hunk(fp, old_s, new_s):
    lines = []
    try:
        with open(fp) as f:
            file_lines = f.read().split('\n')
        file_content = '\n'.join(file_lines)
        pos = file_content.find(old_s)
        if pos >= 0:
            start_line = file_content[:pos].count('\n')
            old_lines = old_s.split('\n') if old_s else []
            new_lines = new_s.split('\n') if new_s else []

            ctx_start = max(0, start_line - CONTEXT)
            for i in range(ctx_start, start_line):
                lines.append({'type': 'ctx', 'num': i + 1, 'text': file_lines[i]})
            for i, text in enumerate(old_lines):
                lines.append({'type': 'del', 'num': start_line + i + 1, 'text': text})
            for i, text in enumerate(new_lines):
                lines.append({'type': 'add', 'num': start_line + i + 1, 'text': text})
            end_old = start_line + len(old_lines)
            end_new = start_line + len(new_lines)
            ctx_end = min(len(file_lines), end_old + CONTEXT)
            for i in range(end_old, ctx_end):
                lines.append({'type': 'ctx', 'num': end_new + (i - end_old) + 1, 'text': file_lines[i]})
    except Exception:
        pass
    return {'lines': lines}

def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else []

def write_json(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f)

def read_text(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except FileNotFoundError:
        return ''

def write_text(path, text):
    with open(path, 'w') as f:
        f.write(text)

def hunk_sort_key(h):
    for line in h.get('lines', []):
        if 'num' in line:
            return line['num']
    return float('inf')

def merge_overlapping_hunks(hunks):
    if len(hunks) <= 1:
        return hunks
    merged = [{'lines': list(hunks[0]['lines'])}]
    for hunk in hunks[1:]:
        prev = merged[-1]
        prev_lines = prev['lines']
        curr_lines = list(hunk['lines'])
        if not prev_lines or not curr_lines:
            merged.append({'lines': curr_lines})
            continue
        prev_max = max(l['num'] for l in prev_lines)
        curr_min = min(l['num'] for l in curr_lines)
        if curr_min <= prev_max:
            curr_edit_nums = set(l['num'] for l in curr_lines if l['type'] != 'ctx')
            trimmed_prev = [l for l in prev_lines if not (l['type'] == 'ctx' and l['num'] in curr_edit_nums)]
            trimmed_curr = [l for l in curr_lines if not (l['type'] == 'ctx' and l['num'] <= prev_max)]
            prev['lines'] = trimmed_prev + trimmed_curr
        else:
            merged.append({'lines': curr_lines})
    return merged

def send_and_wait(fp, hunks):
    \"\"\"Write pending diff for the runner, poll for user response.
    Returns True if approved.\"\"\"
    hunks = merge_overlapping_hunks(sorted(hunks, key=hunk_sort_key))

    for f in (PENDING, RESPONSE):
        try: os.remove(f)
        except FileNotFoundError: pass

    payload = {
        'diff_id': str(uuid.uuid4()),
        'file_path': fp,
        'hunks': hunks,
    }
    write_json(PENDING, payload)

    for _ in range(TIMEOUT * 2):
        if os.path.exists(RESPONSE):
            resp = read_json(RESPONSE, {})
            try: os.remove(RESPONSE)
            except: pass
            try: os.remove(PENDING)
            except: pass
            return resp.get('approved', False)
        time.sleep(0.5)

    try: os.remove(PENDING)
    except: pass
    return False

# ── main logic ────────────────────────────────────────────────────

current = read_text(CURRENT_FILE)

# File transition — send accumulated hunks for the *previous* file
if current and current != file_path:
    hunks = read_json(ACCUMULATOR, [])
    if hunks:
        approved = send_and_wait(current, hunks)
        if not approved:
            # Revert all edits to previous file
            try: shutil.copy2(FILE_BACKUP, current)
            except Exception: pass
    # Clear accumulator for the new file
    write_json(ACCUMULATOR, [])

# Starting a new file (or first edit ever) — take a backup
if current != file_path:
    try: shutil.copy2(file_path, FILE_BACKUP)
    except Exception: pass
    write_text(CURRENT_FILE, file_path)

# Build hunk for this edit and accumulate
hunk = build_hunk(file_path, old_string, new_string)
acc = read_json(ACCUMULATOR, [])
acc.append(hunk)
write_json(ACCUMULATOR, acc)

# Always allow — approval happens at file boundaries
sys.exit(0)
"
