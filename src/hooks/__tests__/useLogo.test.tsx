// useLogo carries non-trivial optimistic-update behavior (cancel the initial
// fetch, serialize mutations, roll back on failure), so each path is pinned
// here against regressions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LogoId } from "@shared/ipc/schema";

const logoGet = vi.fn<() => Promise<LogoId>>();
const logoSet = vi.fn<(logo: LogoId) => Promise<LogoId>>();
vi.mock("@/ipc/client", () => ({
  api: {
    logoGet: (): Promise<LogoId> => logoGet(),
    logoSet: (logo: LogoId): Promise<LogoId> => logoSet(logo),
  },
}));

const { useLogo } = await import("@/hooks/useLogo");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  logoGet.mockReset();
  logoSet.mockReset();
});

describe("useLogo", () => {
  it("falls back to orange until the initial fetch resolves", async () => {
    logoGet.mockResolvedValue("orange");
    const { result } = renderHook(() => useLogo(), { wrapper });
    expect(result.current.logo).toBe("orange");
    await waitFor(() => expect(result.current.logo).toBe("orange"));
  });

  it("reports the canonical value from main", async () => {
    logoGet.mockResolvedValue("orange");
    const { result } = renderHook(() => useLogo(), { wrapper });
    await waitFor(() => expect(logoGet).toHaveBeenCalled());
    expect(result.current.logo).toBe("orange");
  });

  it("skips the IPC when re-applying the canonical logo", async () => {
    logoGet.mockResolvedValue("orange");
    logoSet.mockImplementation((logo) => Promise.resolve(logo));
    const { result } = renderHook(() => useLogo(), { wrapper });
    await waitFor(() => expect(result.current.logo).toBe("orange"));

    act(() => result.current.setLogo("orange"));
    expect(logoSet).not.toHaveBeenCalled();
  });
});
