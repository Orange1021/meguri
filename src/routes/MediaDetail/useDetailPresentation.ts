import { useCallback, useRef } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  MODAL_SIZE_KEY,
  PRESENTATION_KEY,
  type ModalSize,
  type Presentation,
} from "./MediaModal";

/**
 * How the detail view is shown: modal or side peek, plus its remembered modal
 * size.
 *
 * Both the presentation and the modal size are remembered, so the view
 * reopens the way it was last left, and going peek → modal lands on the modal
 * size that was last chosen. Fullscreen is owned by the video player itself.
 */
export function useDetailPresentation() {
  const [modalSize, setModalSize] = useLocalStorage<ModalSize>(
    MODAL_SIZE_KEY,
    "large",
    (raw) => (raw === "small" ? "small" : "large"),
  );
  const toggleModalSize = useCallback(
    () => setModalSize((prev) => (prev === "small" ? "large" : "small")),
    [setModalSize],
  );
  const [presentation, setPresentation] = useLocalStorage<Presentation>(
    PRESENTATION_KEY,
    "modal",
    (raw) => (raw === "peek" ? "peek" : "modal"),
  );

  const modalRef = useRef<HTMLDivElement>(null);

  return {
    modalSize,
    toggleModalSize,
    presentation,
    setPresentation,
    isPeek: presentation === "peek",
    modalRef,
  };
}
