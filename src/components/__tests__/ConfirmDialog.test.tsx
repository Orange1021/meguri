import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useConfirm } from "@/components/ConfirmDialog";
import { renderWithProviders } from "@/test/renderWithProviders";

/** Asks two confirms back to back and lists how each was answered. */
function TwoConfirms() {
  const confirm = useConfirm();
  const [answers, setAnswers] = useState<string[]>([]);
  const record = (label: string) => (ok: boolean) =>
    setAnswers((prev) => [...prev, `${label}:${ok}`]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void confirm({ message: "First?" }).then(record("first"));
          void confirm({ message: "Second?" }).then(record("second"));
        }}
      >
        ask
      </button>
      <output>{answers.join(",")}</output>
    </>
  );
}

describe("ConfirmProvider", () => {
  it("queues a confirm requested while another is open", async () => {
    renderWithProviders(<TwoConfirms />);
    fireEvent.click(screen.getByRole("button", { name: "ask" }));

    // The first prompt stays up; the second waits instead of replacing it.
    expect(await screen.findByText("First?")).toBeTruthy();
    expect(screen.queryByText("Second?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Second?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "first:true,second:false",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
