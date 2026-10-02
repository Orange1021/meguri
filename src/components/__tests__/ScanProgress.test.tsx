import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { ScanProgress } from "@/components/ScanProgress";
import { renderWithProviders } from "@/test/renderWithProviders";

type ProgressPayload = {
  jobId: string;
  phase: string;
  done: number;
  total: number;
};

type DonePayload = {
  jobId: string;
  stats: {
    inserted: number;
    updated: number;
    moved: number;
    deleted: number;
    unchanged: number;
  };
};

const listeners = vi.hoisted(() => ({
  progress: undefined as ((payload: ProgressPayload) => void) | undefined,
  done: undefined as ((payload: DonePayload) => void) | undefined,
}));

vi.mock("@/ipc/client", () => ({
  api: { scanCancel: vi.fn() },
  events: {
    onScanProgress: vi.fn((callback: (payload: ProgressPayload) => void) => {
      listeners.progress = callback;
      return Promise.resolve(() => {});
    }),
    onThumbDone: vi.fn(() => Promise.resolve(() => {})),
    onScanDone: vi.fn((callback: (payload: DonePayload) => void) => {
      listeners.done = callback;
      return Promise.resolve(() => {});
    }),
  },
  ALL_ID: "__all__",
}));

afterEach(() => {
  listeners.progress = undefined;
  listeners.done = undefined;
});

describe("ScanProgress", () => {
  it("shows the derived-assets phase after tagging reaches 100%", () => {
    renderWithProviders(<ScanProgress />);

    act(() => {
      listeners.progress?.({
        jobId: "job-1",
        phase: "tags",
        done: 1,
        total: 1,
      });
    });
    expect(screen.getByText(/Tagging/)).toBeTruthy();

    act(() => {
      listeners.progress?.({
        jobId: "job-1",
        phase: "assets",
        done: 0,
        total: 0,
      });
    });
    expect(screen.getByText(/Preparing supporting assets/)).toBeTruthy();
    expect(screen.queryByText(/Tagging/)).toBeNull();
  });
});
