import { useEffect, useState } from 'react';
import { getFrameThumb } from '../services/frameImages';

/** Lazily loads a small preview for a frame id; undefined until ready. */
export function useFrameThumb(frameId: string | undefined): string | undefined {
  const [state, setState] = useState<{ id?: string; src?: string }>({});
  useEffect(() => {
    if (!frameId) return;
    let cancelled = false;
    void getFrameThumb(frameId).then((src) => {
      if (!cancelled) setState({ id: frameId, src });
    });
    return () => {
      cancelled = true;
    };
  }, [frameId]);
  return state.id === frameId ? state.src : undefined;
}
