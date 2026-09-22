import { useEffect, useState } from "react";

export interface Viewport {
  width: number;
  height: number;
  /** Enough room to put two maps side by side and still read both. */
  canSplitHorizontally: boolean;
  isPortrait: boolean;
}

/** Below this, two maps side by side are two maps you cannot read. */
const SPLIT_MIN_WIDTH = 860;

export function useViewport(): Viewport {
  const read = (): Viewport => {
    const width = typeof window === "undefined" ? 1024 : window.innerWidth;
    const height = typeof window === "undefined" ? 768 : window.innerHeight;
    return {
      width,
      height,
      canSplitHorizontally: width >= SPLIT_MIN_WIDTH,
      isPortrait: height >= width,
    };
  };

  const [viewport, setViewport] = useState<Viewport>(read);

  useEffect(() => {
    const onResize = (): void => setViewport(read());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return viewport;
}
