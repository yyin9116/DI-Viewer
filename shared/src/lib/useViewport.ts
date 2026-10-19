import { useEffect, useState } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * The shell is injected into the page it is browsing, so "responsive" here
 * means reacting to the actual window size the user resized to — not to a
 * media query of a host page we do not control.
 */
export function useViewport(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight
  }));

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = { width: window.innerWidth, height: window.innerHeight };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next
      );
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return size;
}
