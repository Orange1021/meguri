// Types for electron-launch.cjs; keep in sync when its options change.
export declare const mainScript: string;

export declare function electronLaunchOptions(options?: {
  args?: string[];
  env?: Record<string, string>;
}): {
  executablePath: string;
  args: string[];
  env: Record<string, string>;
};
