import { describe, expect, it } from "vitest";
import { dirOf, fileNameOf } from "@/lib/relPath";

describe("fileNameOf", () => {
  it("extracts the file name from a POSIX relative path", () => {
    expect(fileNameOf("sub/dir/video.mp4")).toBe("video.mp4");
  });

  it("extracts the file name from a Windows relative path", () => {
    expect(fileNameOf("sub\\dir\\video.mp4")).toBe("video.mp4");
  });

  it("returns the path as-is when it has no separator", () => {
    expect(fileNameOf("video.mp4")).toBe("video.mp4");
  });
});

describe("dirOf", () => {
  it("returns the folder of a POSIX relative path", () => {
    expect(dirOf("sub/dir/video.mp4")).toBe("sub/dir");
  });

  it("returns the folder of a Windows relative path", () => {
    expect(dirOf("sub\\dir\\video.mp4")).toBe("sub\\dir");
  });

  it("returns an empty string for a file at the root", () => {
    expect(dirOf("video.mp4")).toBe("");
  });
});
