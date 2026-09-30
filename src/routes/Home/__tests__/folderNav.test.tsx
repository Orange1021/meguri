import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FOLDER_BACK_LIMIT, useFolderNav } from "@/routes/Home/useFolderNav";

function setup(initialWs = "ws1") {
  return renderHook(({ ws }) => useFolderNav(ws), {
    initialProps: { ws: initialWs },
  });
}

describe("useFolderNav", () => {
  it("starts at the workspace root with nothing to go back to", () => {
    const { result } = setup();
    expect(result.current.path).toBe("");
    expect(result.current.canGoBack).toBe(false);
  });

  it("enters folders and goes back along the way it came", () => {
    const { result } = setup();
    act(() => result.current.enter("Movie"));
    act(() => result.current.enter("Movie/2024"));
    expect(result.current.path).toBe("Movie/2024");
    act(() => result.current.goTo(""));
    expect(result.current.path).toBe("");
    act(() => result.current.goBack());
    expect(result.current.path).toBe("Movie/2024");
    act(() => result.current.goBack());
    expect(result.current.path).toBe("Movie");
    act(() => result.current.goBack());
    expect(result.current.path).toBe("");
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.goBack());
    expect(result.current.path).toBe("");
  });

  it("goes up one level and remembers it for back", () => {
    const { result } = setup();
    act(() => result.current.enter("a/b/c"));
    act(() => result.current.goUp());
    expect(result.current.path).toBe("a/b");
    act(() => result.current.goBack());
    expect(result.current.path).toBe("a/b/c");
  });

  it("does nothing going up from the root or moving to where it already is", () => {
    const { result } = setup();
    act(() => result.current.goUp());
    act(() => result.current.goTo(""));
    expect(result.current.canGoBack).toBe(false);
  });

  it("replaces a vanished folder without adding a step", () => {
    const { result } = setup();
    act(() => result.current.enter("Movie/2024"));
    act(() => result.current.replace("Movie"));
    expect(result.current.path).toBe("Movie");
    act(() => result.current.goBack());
    expect(result.current.path).toBe("");
  });

  it("drops back steps that would land on the folder replaced into", () => {
    const { result } = setup();
    act(() => result.current.enter("Movie"));
    act(() => result.current.enter("Movie/2024"));
    // Movie/2024 vanished; its parent is also the last step back.
    act(() => result.current.replace("Movie"));
    expect(result.current.path).toBe("Movie");
    act(() => result.current.goBack());
    expect(result.current.path).toBe("");
  });

  it("caps how far back it remembers", () => {
    const { result } = setup();
    for (let i = 0; i < FOLDER_BACK_LIMIT + 10; i++) {
      act(() => result.current.enter(`f${i}`));
    }
    let steps = 0;
    while (result.current.canGoBack) {
      act(() => result.current.goBack());
      steps++;
    }
    expect(steps).toBe(FOLDER_BACK_LIMIT);
  });

  it("keeps each workspace's place separately", () => {
    const { result, rerender } = setup("ws1");
    act(() => result.current.enter("Movie"));
    rerender({ ws: "ws2" });
    expect(result.current.path).toBe("");
    act(() => result.current.enter("Photos"));
    rerender({ ws: "ws1" });
    expect(result.current.path).toBe("Movie");
  });

  it("visits a folder of the workspace shown, remembered for back", () => {
    const { result } = setup();
    act(() => result.current.enter("Movie"));
    act(() => result.current.visit("ws1", "Photos/2024"));
    expect(result.current.path).toBe("Photos/2024");
    act(() => result.current.goBack());
    expect(result.current.path).toBe("Movie");
  });

  it("visits a folder of another workspace, waiting there for the switch", () => {
    const { result, rerender } = setup();
    act(() => result.current.visit("ws2", "Clips"));
    // The workspace shown is untouched until the caller switches to ws2.
    expect(result.current.path).toBe("");
    rerender({ ws: "ws2" });
    expect(result.current.path).toBe("Clips");
    expect(result.current.canGoBack).toBe(true);
  });

  it("adds no back step when visiting the folder already shown", () => {
    const { result } = setup();
    act(() => result.current.enter("Movie"));
    act(() => result.current.visit("ws1", "Movie"));
    act(() => result.current.goBack());
    expect(result.current.path).toBe("");
    expect(result.current.canGoBack).toBe(false);
  });
});
