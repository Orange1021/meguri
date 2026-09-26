// Tag completion: what it offers, and what it refuses to offer late.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useTagSuggestions } from "@/hooks/useTagSuggestions";

const mocks = vi.hoisted(() => ({
  tagsList: vi.fn<(...args: unknown[]) => Promise<string[]>>(),
}));

vi.mock("@/ipc/client", () => ({
  api: { tagsList: (...args: unknown[]) => mocks.tagsList(...args) },
  ALL_ID: "__all__",
}));

function Probe({
  input,
  workspaceId,
}: {
  input: string;
  workspaceId?: string;
}) {
  const suggestions = useTagSuggestions(workspaceId, input);
  return <span data-testid="out">{suggestions.join(",")}</span>;
}

const out = () => screen.getByTestId("out").textContent;

describe("useTagSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("offers what the lookup returned", async () => {
    mocks.tagsList.mockResolvedValue(["beach", "beacon"]);
    render(<Probe input="bea" workspaceId="ws" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(out()).toBe("beach,beacon");
  });

  it("does not look anything up without a prefix or a workspace", async () => {
    render(<Probe input="  " workspaceId="ws" />);
    render(<Probe input="bea" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.tagsList).not.toHaveBeenCalled();
  });

  it("drops a response that arrives after the input moved on", async () => {
    // The first lookup is still in flight when the input changes; its answer
    // must not land on top of the newer one.
    let resolveFirst: ((names: string[]) => void) | undefined;
    mocks.tagsList.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    mocks.tagsList.mockResolvedValueOnce(["tripod"]);

    const view = render(<Probe input="tri" workspaceId="ws" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    view.rerender(<Probe input="trip" workspaceId="ws" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(out()).toBe("tripod");

    await act(async () => {
      resolveFirst?.(["trial", "triangle"]);
      await Promise.resolve();
    });
    expect(out()).toBe("tripod");
  });

  it("drops a failure that arrives after the input moved on", async () => {
    let rejectFirst: ((e: Error) => void) | undefined;
    mocks.tagsList.mockImplementationOnce(
      () =>
        new Promise<string[]>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    mocks.tagsList.mockResolvedValueOnce(["camp"]);

    const view = render(<Probe input="ca" workspaceId="ws" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    view.rerender(<Probe input="cam" workspaceId="ws" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => {
      rejectFirst?.(new Error("too late"));
      await Promise.resolve();
    });
    // The stale failure would otherwise clear the list the user is looking at.
    expect(out()).toBe("camp");
  });
});
