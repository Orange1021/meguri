// Shares the active list ordering (and its pagination controls) from the list
// screen (Home) down to the detail modal, so the detail can navigate to the
// previous/next file following the exact order/filter the user is browsing.
import { createContext, useContext } from "react";
import type { FileRow } from "@/ipc/types";

export interface MediaNav {
  /** The currently loaded list items, in display order. */
  items: FileRow[];
  /** Global index offset of items[0] within the full filtered result set. */
  listOffset: number;
  /** Load the next page (used when navigating past the loaded tail). */
  fetchNextPage: () => void;
  /** Whether more pages exist beyond what is loaded. */
  hasNextPage: boolean;
  /** Whether a next-page fetch is in flight. */
  isFetchingNextPage: boolean;
  /** Load the previous page (used when navigating before the loaded head). */
  fetchPreviousPage: () => void;
  /** Whether earlier pages exist before what is loaded. */
  hasPreviousPage: boolean;
  /** Whether a previous-page fetch is in flight. */
  isFetchingPreviousPage: boolean;
  /**
   * The first page has not arrived yet: an empty `items` means "not yet",
   * not "nothing". Optional — a list already on screen is past it.
   */
  isLoading?: boolean;
  /**
   * The folder this order covers ("" for the workspace root), when it is a
   * folder's whole subtree (the playlist's order browsing by folder).
   */
  folder?: string;
}

const MediaNavContext = createContext<MediaNav | null>(null);

export const MediaNavProvider = MediaNavContext.Provider;

/** Returns the list navigation context, or null when none is mounted. */
export function useMediaNav(): MediaNav | null {
  return useContext(MediaNavContext);
}

// The playlist's own order, when it differs from the list's: browsing by
// folder, the list shows the folder's direct files while the player plays
// everything below the folder. Same shape as MediaNav; absent otherwise, and
// the player falls back to the list (see usePlaybackQueue).
const PlaylistNavContext = createContext<MediaNav | null>(null);

export const PlaylistNavProvider = PlaylistNavContext.Provider;

/** The playlist's own order, or null when it plays the list as shown. */
export function usePlaylistNav(): MediaNav | null {
  return useContext(PlaylistNavContext);
}

/**
 * The order playback follows: the playlist's own where there is one, else the
 * list as shown. For the player, and for the detail view the player detoured
 * to (so its prev/next walks what the player was playing).
 */
export function usePlaybackNav(): MediaNav | null {
  const list = useMediaNav();
  const playlist = usePlaylistNav();
  return playlist ?? list;
}
