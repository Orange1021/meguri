import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";
import { useFolderNavKeys } from "@/routes/Home/useFolderNavKeys";

function setup(active = true) {
  const goBack = vi.fn();
  const goUp = vi.fn();
  const hook = renderHook(() => useFolderNavKeys({ active, goBack, goUp }));
  return { goBack, goUp, hook };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useFolderNavKeys", () => {
  it("goes back on Alt+← and Backspace, up on Alt+↑", () => {
    const { goBack, goUp } = setup();
    fireEvent.keyDown(window, { code: "ArrowLeft", altKey: true });
    fireEvent.keyDown(window, { code: "Backspace" });
    fireEvent.keyDown(window, { code: "ArrowUp", altKey: true });
    expect(goBack).toHaveBeenCalledTimes(2);
    expect(goUp).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way while inactive or with other modifiers", () => {
    const { goBack, goUp } = setup(false);
    fireEvent.keyDown(window, { code: "Backspace" });
    expect(goBack).not.toHaveBeenCalled();
    const second = setup();
    fireEvent.keyDown(window, { code: "Backspace", ctrlKey: true });
    fireEvent.keyDown(window, { code: "ArrowUp" });
    expect(second.goBack).not.toHaveBeenCalled();
    expect(second.goUp).not.toHaveBeenCalled();
    expect(goUp).not.toHaveBeenCalled();
  });

  it("leaves Backspace to a dialog laid over the list", () => {
    const { goBack } = setup();
    document.body.innerHTML =
      '<div role="dialog"><button id="chip">beach ×</button></div>';
    document.getElementById("chip")!.focus();
    fireEvent.keyDown(document.activeElement!, { code: "Backspace" });
    expect(goBack).not.toHaveBeenCalled();
  });

  it("leaves Backspace to a text field", () => {
    const { goBack } = setup();
    document.body.innerHTML = '<input id="q" />';
    document.getElementById("q")!.focus();
    fireEvent.keyDown(document.activeElement!, { code: "Backspace" });
    expect(goBack).not.toHaveBeenCalled();
  });

  it("goes back on the mouse's back button", () => {
    const { goBack, hook } = setup();
    const preventDefault = vi.fn();
    hook.result.current.onMouseUp({
      button: 3,
      preventDefault,
    } as unknown as React.MouseEvent);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });
});
