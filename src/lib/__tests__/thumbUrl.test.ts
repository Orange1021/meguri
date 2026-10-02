import { describe, expect, it } from "vitest";
import {
  hasThumbFile,
  mediaPreviewUrl,
  mediaUrl,
  thumbUrl,
} from "@/lib/thumbUrl";

describe("hasThumbFile", () => {
  it("needs both a finished extraction and a file behind it", () => {
    expect(hasThumbFile({ thumbStatus: "done", hasThumb: 1 })).toBe(true);
    // Audio without embedded cover art: done, but nothing was written.
    expect(hasThumbFile({ thumbStatus: "done", hasThumb: 0 })).toBe(false);
    expect(hasThumbFile({ thumbStatus: "pending", hasThumb: 1 })).toBe(false);
    expect(hasThumbFile({ thumbStatus: "error", hasThumb: 0 })).toBe(false);
  });
});

describe("thumbUrl", () => {
  it("addresses the thumbnail through the owning workspace", () => {
    expect(thumbUrl("http://127.0.0.1:1", "ws1", 7)).toBe(
      "http://127.0.0.1:1/ws/ws1/thumb/7",
    );
  });

  it("appends the cache buster only when a version is given", () => {
    expect(thumbUrl("http://h", "ws1", 7, 0)).toBe(
      "http://h/ws/ws1/thumb/7?v=0",
    );
    expect(thumbUrl("http://h", "ws1", 7, 3)).toBe(
      "http://h/ws/ws1/thumb/7?v=3",
    );
  });

  it("is null until the media origin and workspace are known", () => {
    expect(thumbUrl("", "ws1", 7)).toBeNull();
    expect(thumbUrl("http://h", "", 7)).toBeNull();
  });
});

describe("mediaUrl", () => {
  it("addresses the original file through the owning workspace", () => {
    expect(mediaUrl("http://127.0.0.1:1", "ws1", 7)).toBe(
      "http://127.0.0.1:1/ws/ws1/media/7",
    );
  });

  it("appends the cache buster only when a version is given", () => {
    expect(mediaUrl("http://h", "ws1", 7, 0)).toBe(
      "http://h/ws/ws1/media/7?v=0",
    );
  });
});

describe("mediaPreviewUrl", () => {
  it("uses the original image even when no generated thumbnail exists", () => {
    expect(
      mediaPreviewUrl(
        "http://h",
        {
          kind: "image",
          workspaceId: "ws1",
          id: 7,
          thumbStatus: "done",
          hasThumb: 0,
        },
        2,
      ),
    ).toBe("http://h/ws/ws1/media/7?v=2");
  });

  it("keeps cover-less audio on the fallback path", () => {
    expect(
      mediaPreviewUrl("http://h", {
        kind: "audio",
        workspaceId: "ws1",
        id: 7,
        thumbStatus: "done",
        hasThumb: 0,
      }),
    ).toBeNull();
  });
});
