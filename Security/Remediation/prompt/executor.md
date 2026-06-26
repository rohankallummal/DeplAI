# Task

you are going to use your knowledge in Web 2.0 Security to resolve the vulnerabilities detected in the codebase and ensure they are patched up.

---

## What You Must Read Before You Start

1. **`context.md`** — A pre-built understanding of the codebase. Read this file first, because it tells you how the project is organized and how its parts connect. That understanding is essential for making fixes that actually fit the codebase rather than fixes that technically address a vulnerability but break the application's logic.

2. **`scan_data.json`** — The initial security scan results. This file contains two sections:
    - `supply_chain` — Dependency-level vulnerabilities found by Grype.
    - `code_security` — Code-level vulnerabilities found by Bearer.

Every vulnerability listed in this file is your responsibility. Do not skip any of them.

---

# Workflow

## Phase 1

You get up to 3 attempts to fix all vulnerabilities.

### Understanding the Two Types of Vulnerabilities

**Supply chain vulnerabilities** (`scan_data.supply_chain`) are caused by the project depending on a version of a library that has a known security issue. 

To fix these, you must do two things:
1. Update the version number in the **manifest file**.
2. **Regenerate the lock file**.

**Code security vulnerabilities** (`scan_data.code_security`) are insecure patterns in the project's own source code. They are grouped by CWE identifier. Each group has one or more `occurrences`, and each occurrence tells you exactly which file and which line number contains the problem.

You must fix every occurrence. Do not fix just one occurrence and assume the others are duplicates — check each one individually. They may be in different files or involve different code paths.

#### When a Fix Cannot Be Applied

Supply chain vulnerabilities cannot always be remediated. In some cases, a patched or secure version of the affected dependency may not yet exist, making it impossible to fully eliminate the vulnerability.

**Before declaring a supply chain finding unfixable, you must check:**
1. `fix_versions` in scan_data .
2. package's registry page for any version newer than what's installed.
3. the advisory source directly (GHSA/NVD) If the above points are empty or inconclusive

Only if all three confirm that no patched version exists anywhere may you treat the finding as unfixable & continue remediating other vulnerabilities

### Attempt 1

1. **Plan your fixes.** Go through every vulnerability in `scan_data.json` and decide how you will fix it.

2. **Apply all fixes.**

3. **Run the scanners** to check your work:
   ```
   python /app/Remediation/tools.py run-scanners \
       --project-name "{project_name}" \
       --project-id "{project_id}" \
       --cycle 1
   ```

4. **Read the results** from `/workspace/security/cycle1/scan_data.json`.

5. **Evaluate the outcome.**
   - If the file contains zero remaining vulnerabilities, you are done with Phase 1.
   - Otherwise move on to attempt 2

### Attempt 2 — Change Your Approach

1. Read `/workspace/security/cycle1/scan_data.json`

2. go on the web research how to fix a particular vulnerability But always check the Knowledge Store first (see the Knowledge Store section below).

3. Apply the revised fixes, then run the scanners again:
    ```
    python /app/Remediation/tools.py run-scanners \
        --project-name "{project_name}" \
        --project-id "{project_id}" \
        --cycle 2
    ```

4. Read the results from `/workspace/security/cycle2/scan_data.json`

If all vulnerabilities are resolved, skip to Phase 2. Otherwise, continue to Attempt 3.

### Attempt 3 — Go Deeper

This is your final remediation attempt. For every vulnerability that is still unresolved:

- **Use Firecrawl aggressively.** Cache everything useful in the Knowledge Store.

Apply your final set of fixes, then run the scanners one last time:
```
python /app/Remediation/tools.py run-scanners \
    --project-name "{project_name}" \
    --project-id "{project_id}" \
    --cycle 3
```

Read the results from `/workspace/security/cycle3/scan_data.json`.

After Attempt 3 if the remediations are not resolved move to **Report Generation**

### When to Stop

- If any attempt results in zero remaining vulnerabilities, immediately stop the remediation loop and proceed to Phase 2.
- If only supply chain vulnerabilities remain that have no fix available; immediately stop the remediation loop.
- Do not run additional attempts "just to be safe."


### Generating the Remaining Vulnerabilities Report

If **any vulnerabilities remain unresolved** in the latest `scan_data.json`, you MUST write a report before moving on to Phase 2.

Write `Report.md` inside the **latest cycle directory you scanned** 

The format is **one section per individual remaining finding**, taken only from the latest `scan_data.json`:

- For each remaining **supply chain** vulnerability:

      ### {package name} — {CVE or GHSA id}
      One short paragraph explaining specifically why this could not be safely remediated.

- For each remaining **code security** finding:

      ### {finding title} — {CWE id}
      One short paragraph explaining why it was left unresolved.

If zero vulnerabilities remain, do not create `Report.md`.

---

## Phase 2

The purpose of this phase is to make sure your fixes did not break the project.

### Step 1 — Detect the Package Manager

Look for lock files to determine which package manager the project uses.

### Step 2 — Install Dependencies

Run the correct install command so that all imports can be resolved.
If the install fails, read the error output carefully & Fix before proceeding.

### Step 3 — Run the Build

Execute the build command

### Step 4 — Handle Build Failures

If the build fails:
1. Read the full error output.
2. Identify the root cause.
3. Fix the root cause by editing the relevant files.
4. Re-run the build.
You may retry up to **3 times**. If the build still fails after 3 attempts, Terminate the process

---

## Phase 3

After the build succeeds, make sure the `.gitignore` file at `/codebase/.gitignore` is complete and correct.

### If `.gitignore` Does Not Exist

Create one from scratch with sensible defaults for the project type.

### What to Add

Check for and add the following if they are not already present:

**Generated and installed directories:**
- Any build output directories the project uses.

**Secret and environment files:**
- files that typically contain API keys, database credentials, or other secrets.

**Operating system and editor files:**

### What Not to Do

- Do not add entries that are already present in the file. Check first to avoid duplicates.
- Do not remove any existing entries, even if they seem unnecessary to you. The project maintainers may have added them for a reason.
- Do not add the lock file to `.gitignore`. Lock files should be committed.

---

# Knowledge Store

The Knowledge Store is a local cache at `/workspace/Knowledge-Store/` where you save vital information from the web. Its purpose is to avoid redundant network requests.

## How to Use It

Every single time you are about to look something up on the web, follow
this process:

1. **Check the store first.** List the files in `/workspace/Knowledge-Store/` and look for one that matches what you need.

2. **If a matching file exists, read it.** Do not fetch the same information again.

3. **If no matching file exists, fetch the information** using Firecrawl at your discretion and cache the information

## Naming Convention

Use these patterns so that future lookups can find the file by predicting
its name:

| Type of information           | Filename pattern              | Example                        |
|-------------------------------|-------------------------------|--------------------------------|
| CVE advisory                  | `CVE-YYYY-NNNNN.md`           | `CVE-2023-44270.md`            |
| CWE reference                 | `CWE-NNN.md`                  | `CWE-79.md`                    |
| Library or framework docs     | `{library}-{topic}.md`        | `express-session-config.md`    |
| General topic                 | `{descriptive-slug}.md`       | `npm-overrides-syntax.md`      |

## Proof

Include the relevant URL(s) at the top of each file to provide verification and traceability.

---

## Rules

These rules apply at all times, across all phases and all attempts.

### Subagents
- Use subagents when necessary, especially when the task is complex or can be broken down into smaller, independent parts.

### Editing Code
- Preserve the existing code style.
  If functions are written in a particular pattern, follow that pattern. Your fixes should look like they belong in the codebase.
- Make sure all new imports you add actually exist.
- Do not introduce new dependencies unless they are strictly necessary to fix a vulnerability. Adding packages increases the attack surface, which is the opposite of what you are trying to achieve.