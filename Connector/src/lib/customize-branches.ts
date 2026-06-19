// Single source of truth for DeplAI customization branch naming.
// Mirror: Customization/constants.py — keep both in sync.

export const DEPLAI_BRANCH_PREFIX = 'deplai/customize-';

/** The legacy / first-stream branch for a project: `deplai/customize-{projectId}`. */
export function legacyStreamBranch(projectId: string): string {
  return `${DEPLAI_BRANCH_PREFIX}${projectId}`;
}

/** A fresh stream branch: `deplai/customize-{projectId}-{shortid}` (shortid = 6 base36 chars). */
export function newStreamBranch(projectId: string): string {
  const shortid = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${DEPLAI_BRANCH_PREFIX}${projectId}-${shortid}`;
}

/** Any DeplAI automation branch (regardless of project). */
export function isDeplaiBranch(ref: string): boolean {
  return ref.startsWith(DEPLAI_BRANCH_PREFIX);
}

/**
 * A DeplAI stream branch belonging to this specific project: either the exact
 * legacy `deplai/customize-{projectId}` or a `deplai/customize-{projectId}-{shortid}`
 * stream of it. Safe from cross-project prefix collisions because `projectId` is a
 * fixed-format UUID.
 */
export function isProjectStreamBranch(ref: string, projectId: string): boolean {
  return (
    ref === legacyStreamBranch(projectId) ||
    ref.startsWith(`${DEPLAI_BRANCH_PREFIX}${projectId}-`)
  );
}
