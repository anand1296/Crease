import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGame } from '../../state/game.ts';
import { FrameBudgetController } from './adaptiveQuality.ts';

/**
 * Keeps the frame rate up on modest GPUs by trading resolution (and, on
 * High, ambient occlusion) for speed; see adaptiveQuality.ts for the rule.
 * Frames are only measured while the view is live and the match isn't
 * loading.
 */
export function FrameBudget({ live }: { live: boolean }) {
  const budget = useMemo(() => new FrameBudgetController(), []);

  useEffect(() => {
    budget.settle();
  }, [live, budget]);

  useFrame((_, delta) => {
    const g = useGame.getState();
    if (!live || g.warming || document.hidden) {
      budget.settle();
      return;
    }
    const next = budget.push(delta, g.perf);
    if (next !== undefined) g.setPerf(next);
  });
  return null;
}
