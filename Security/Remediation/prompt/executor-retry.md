## Previous Cycle History

This is cycle {cycle_num}. Previous remediation attempts:

{cycle_history}

CRITICAL: For any vulnerability attempted but NOT resolved previously,
you MUST use a DIFFERENT strategy. Do not repeat failed approaches.

Review what was tried, why it failed, and choose an alternative.

## Knowledge Store Retrieval

Before performing any new web searches, check the knowledge store at
`/workspace/Knowledge-Store/index.json` for information already
fetched in previous cycles.

1. Read `index.json` and scan for entries matching the vulnerability you are
   working on (by CVE/CWE ID, library name, or related tags).
2. If a relevant entry exists → read the cached file. Do NOT re-fetch.
3. Only perform a new web search if the knowledge store does not contain
   relevant information for the current vulnerability.
4. If you do fetch new information, cache it into the knowledge store
   following the workflow and naming conventions in your main instructions.
