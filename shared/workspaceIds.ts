/** Sentinel workspace ID for the virtual "All" (cross-workspace) view. */
export const ALL_ID = "__all__";

/** Prefix that marks an active-target string as a user collection. */
export const COLLECTION_ID_PREFIX = "collection:";

/**
 * ID of the built-in "Watch Later" collection. Unlike user collections (whose IDs
 * are random UUIDs) this one is a fixed constant: it is seeded on config load and
 * both processes need to address it without looking it up by name.
 */
export const WATCH_LATER_ID = "watch-later";

/** Build the active-target string for a collection (passed to workspaceSwitch). */
export function collectionTarget(id: string): string {
  return `${COLLECTION_ID_PREFIX}${id}`;
}

/**
 * Cap on a workspace or collection id crossing IPC.
 *
 * Real ids are short and generated: a workspace id is a 16-character path hash
 * (Workspaces.idFor), and a collection id is that prefix plus a short suffix.
 * The cap is not there to validate the format — main resolves an id against the
 * ids it actually holds — but so an id-shaped string cannot be used to hand the
 * main process an arbitrary amount of data.
 */
export const MAX_WORKSPACE_ID = 64;
