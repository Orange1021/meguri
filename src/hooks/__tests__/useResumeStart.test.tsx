import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { useResumeStart } from "@/hooks/useResumeStart";

function wrapper({ children }: { children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}

type Args = Parameters<typeof useResumeStart>[0];

function setup(initial: Args) {
  return renderHook((args: Args) => useResumeStart(args), {
    wrapper,
    initialProps: initial,
  });
}

describe("useResumeStart", () => {
  afterEach(() => localStorage.clear());

  it("lets ?t= win over the stored position", () => {
    const { result } = setup({ visitKey: "a", explicit: 42, resume: 300 });
    expect(result.current.startAt).toBe(42);
    expect(result.current.resumed).toBe(false);
  });

  it("opens at the stored position and says so", () => {
    const { result } = setup({ visitKey: "a", explicit: 0, resume: 300 });
    expect(result.current.startAt).toBe(300);
    expect(result.current.resumed).toBe(true);
  });

  it("starts from zero when resuming is turned off", () => {
    localStorage.setItem(
      "meguri.prefs",
      JSON.stringify({ resumePlayback: false }),
    );
    const { result } = setup({ visitKey: "a", explicit: 0, resume: 300 });
    expect(result.current.startAt).toBe(0);
    expect(result.current.resumed).toBe(false);
  });

  it("holds its answer while the stored position moves during the visit", () => {
    const { result, rerender } = setup({
      visitKey: "a",
      explicit: 0,
      resume: 300,
    });
    rerender({ visitKey: "a", explicit: 0, resume: 420 });
    expect(result.current.startAt).toBe(300);
    // A new visit settles afresh.
    rerender({ visitKey: "b", explicit: 0, resume: 420 });
    expect(result.current.startAt).toBe(420);
  });

  it("hides the notice once the user starts over", () => {
    const { result } = setup({ visitKey: "a", explicit: 0, resume: 300 });
    act(() => result.current.dismiss());
    expect(result.current.resumed).toBe(false);
  });

  it("uses ?t= alone while the file is still loading", () => {
    const { result } = setup({ visitKey: null, explicit: 12, resume: 300 });
    expect(result.current).toMatchObject({ startAt: 12, resumed: false });
  });
});
