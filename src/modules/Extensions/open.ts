import { lazyDialog } from "~/ui/LazyFeature";

export const openExtensions = lazyDialog(async () => (await import("./Extensions")).openExtensions);
