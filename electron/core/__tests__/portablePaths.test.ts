import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  layoutForRoot,
  resolvePortableLayout,
  resolveWorkspaceLocator,
} from "../portablePaths.js";

describe("resolvePortableLayout", () => {
  it("resolves a packaged App directory to its portable parent", () => {
    const layout = resolvePortableLayout({
      appPath: "D:/PortableVideoLibrary/App/resources/app.asar",
      executablePath: "D:/PortableVideoLibrary/App/PortableVideoLibrary.exe",
      isPackaged: true,
    });

    expect(layout.rootDir).toBe(path.resolve("D:/PortableVideoLibrary"));
    expect(layout.appDir).toBe(path.resolve("D:/PortableVideoLibrary/App"));
    expect(layout.dataDir).toBe(path.resolve("D:/PortableVideoLibrary/Data"));
    expect(layout.mediaDir).toBe(path.resolve("D:/PortableVideoLibrary/Media"));
  });

  it("uses an explicit override for tests and development", () => {
    const layout = resolvePortableLayout({
      appPath: "D:/Projects/PortableVideoLibrary",
      executablePath: "D:/Applications/electron.exe",
      isPackaged: false,
      portableRootOverride: "C:/Temp/portable-fixture",
    });

    expect(layout.rootDir).toBe(path.resolve("C:/Temp/portable-fixture"));
    expect(layout.dataDir).toBe(path.resolve("C:/Temp/portable-fixture/Data"));
  });

  it("keeps Data beside a directly launched portable executable", () => {
    const layout = resolvePortableLayout({
      appPath: "D:/PortableVideoLibrary",
      executablePath: "D:/PortableVideoLibrary/OrangeView.exe",
      isPackaged: true,
      portableExecutableDir: "D:/PortableVideoLibrary",
    });

    expect(layout.rootDir).toBe(path.resolve("D:/PortableVideoLibrary"));
    expect(layout.dataDir).toBe(path.resolve("D:/PortableVideoLibrary/Data"));
  });

  it("keeps the documented App layout when the launcher reports App", () => {
    const layout = resolvePortableLayout({
      appPath: "D:/PortableVideoLibrary/App/resources/app.asar",
      executablePath: "D:/PortableVideoLibrary/App/OrangeView.exe",
      isPackaged: true,
      portableExecutableDir: "D:/PortableVideoLibrary/App",
    });

    expect(layout.rootDir).toBe(path.resolve("D:/PortableVideoLibrary"));
    expect(layout.dataDir).toBe(path.resolve("D:/PortableVideoLibrary/Data"));
  });
});

describe("resolveWorkspaceLocator", () => {
  it("rejects relative workspace locators that escape Media", () => {
    const layout = layoutForRoot("D:/PortableVideoLibrary");

    expect(() =>
      resolveWorkspaceLocator(layout, {
        kind: "portable-relative",
        value: "../outside",
      }),
    ).toThrow("workspace locator escapes media root");
  });

  it("resolves a normalized relative workspace below Media", () => {
    const layout = layoutForRoot("D:/PortableVideoLibrary");

    expect(
      resolveWorkspaceLocator(layout, {
        kind: "portable-relative",
        value: "柯南/第一季",
      }),
    ).toBe(path.resolve("D:/PortableVideoLibrary/Media/柯南/第一季"));
  });
});
