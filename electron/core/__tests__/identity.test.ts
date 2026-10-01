import { describe, expect, it } from "vitest";
import { decideIdentity, type IdentityDecisionInput } from "../identity.js";

describe("identity decision", () => {
  it("keeps an unchanged physical row", () => {
    const input: IdentityDecisionInput = {
      currentVideoId: "v-old",
      previousKey: "k",
      currentKey: "k",
      candidates: [],
      strong: true,
    };

    expect(decideIdentity(input)).toEqual({ kind: "keep", videoId: "v-old" });
  });

  it("reuses one strong logical candidate", () => {
    const input: IdentityDecisionInput = {
      currentVideoId: "v-new",
      previousKey: null,
      currentKey: "k",
      candidates: [{ videoId: "v-existing", strong: true }],
      strong: true,
    };

    expect(decideIdentity(input)).toEqual({
      kind: "reuse",
      videoId: "v-existing",
    });
  });

  it("creates a new identity without candidates", () => {
    const input: IdentityDecisionInput = {
      currentVideoId: "v-provisional",
      previousKey: null,
      currentKey: "k",
      candidates: [],
      strong: true,
    };

    expect(decideIdentity(input)).toEqual({
      kind: "create",
      videoId: "v-provisional",
    });
  });

  it("does not choose the first of multiple candidates", () => {
    const input: IdentityDecisionInput = {
      currentVideoId: "v-provisional",
      previousKey: null,
      currentKey: "k",
      candidates: [
        { videoId: "v-b", strong: true },
        { videoId: "v-a", strong: true },
      ],
      strong: true,
    };

    expect(decideIdentity(input)).toEqual({
      kind: "conflict",
      issueType: "ambiguous_identity",
      candidateVideoIds: ["v-a", "v-b"],
    });
  });

  it("does not auto-bind weak evidence", () => {
    const input: IdentityDecisionInput = {
      currentVideoId: "v-provisional",
      previousKey: null,
      currentKey: "k",
      candidates: [{ videoId: "v-a", strong: false }],
      strong: false,
    };

    expect(decideIdentity(input)).toEqual({
      kind: "conflict",
      issueType: "probe_failed",
      candidateVideoIds: ["v-a"],
    });
  });

  it("never keeps the old identity after a content replacement", () => {
    const input: IdentityDecisionInput = {
      currentVideoId: "v-provisional",
      previousKey: "old-key",
      currentKey: "new-key",
      candidates: [],
      strong: true,
    };

    expect(decideIdentity(input)).toEqual({
      kind: "create",
      videoId: "v-provisional",
    });
  });
});
