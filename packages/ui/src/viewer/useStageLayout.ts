import { useEffect, useMemo, useState, type RefObject } from 'react';

export interface StageLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  containerWidth: number;
  containerHeight: number;
}

export function useStageLayout(
  containerRef: RefObject<HTMLElement | null>,
  logicalWidth: number,
  logicalHeight: number,
): StageLayout {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => observer.disconnect();
  }, [containerRef]);

  return useMemo(() => {
    if (!size.width || !size.height || !logicalWidth || !logicalHeight) {
      return {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        containerWidth: size.width,
        containerHeight: size.height,
      };
    }

    const scale = Math.min(size.width / logicalWidth, size.height / logicalHeight);
    return {
      scale,
      offsetX: (size.width - logicalWidth * scale) / 2,
      offsetY: (size.height - logicalHeight * scale) / 2,
      containerWidth: size.width,
      containerHeight: size.height,
    };
  }, [logicalHeight, logicalWidth, size.height, size.width]);
}
