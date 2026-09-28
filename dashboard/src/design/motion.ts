import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, type ViewStyle } from 'react-native';

/**
 * Motion for the web build. React Native Web accepts CSS transition and
 * keyframe style props, which run off the main thread; native keeps its own
 * platform behaviour and receives none of these.
 *
 * Curves are the same ones the landing page uses. The spring is
 * `{ duration: 0.5, bounce: 0.15 }` sampled into CSS `linear()`: it settles in
 * about 640ms with a 0.6% overshoot, enough to feel physical without bouncing.
 */
export const easing = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  spring:
    'linear(0, 0.035, 0.119, 0.228, 0.345, 0.46, 0.565, 0.658, 0.737, 0.802, 0.856, 0.897, 0.93, 0.954, 0.972, 0.985, 0.994, 1, 1.003, 1.005, 1.006, 1.006, 1.006, 1.005, 1.005, 1.004, 1.003, 1.003, 1)',
} as const;

const SPRING_MS = 640;

/** Tracks the OS reduced-motion setting, including changes while open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

function web(style: Record<string, unknown>): ViewStyle {
  return (Platform.OS === 'web' ? style : {}) as ViewStyle;
}

/**
 * Press feedback for buttons: a 3% scale-down while held. The scale itself is
 * applied by the caller from Pressable's `pressed`; this makes it ease.
 */
export function pressTransition(): ViewStyle {
  return web({
    // The scale is feedback and takes the strong ease-out; the colour is a
    // hover-like change and takes plain ease, a little longer.
    transitionProperty: 'transform, background-color',
    transitionDuration: '120ms, 150ms',
    transitionTimingFunction: `${easing.out}, ease`,
  });
}

type Entrance = 'panel' | 'sheet' | 'drawer' | 'content' | 'notice';

const ENTRANCES: Record<Entrance, { from: Record<string, unknown>; ms: number; curve: string }> = {
  // Centred dialogs: arrive from just below and slightly small, on the spring.
  panel: { from: { opacity: 0, transform: 'translateY(8px) scale(0.97)' }, ms: SPRING_MS, curve: easing.spring },
  // Bottom sheets rise by their own height, on the drawer curve.
  sheet: { from: { transform: 'translateY(100%)' }, ms: 320, curve: easing.drawer },
  // The navigation drawer comes in from its own edge.
  drawer: { from: { transform: 'translateX(-100%)' }, ms: 300, curve: easing.drawer },
  // Content revealed inside a section: barely-there, it is opened often.
  content: { from: { opacity: 0, transform: 'translateY(-4px)' }, ms: 160, curve: easing.out },
  // Inline notices and errors that appear after an action.
  notice: { from: { opacity: 0, transform: 'translateY(4px)' }, ms: 200, curve: easing.out },
};

/**
 * React Native Web drops `animationKeyframes` from inline style objects; only
 * styles registered through StyleSheet.create are compiled to real keyframes.
 * So every entrance, and its reduced-motion twin, is registered once here.
 */
function entranceStyle(kind: Entrance, reduced: boolean): Record<string, unknown> {
  const spec = ENTRANCES[kind];
  const from = reduced ? { opacity: 0 } : spec.from;
  return {
    animationKeyframes: [{ from, to: { opacity: 1, transform: 'none' } }],
    animationDuration: `${reduced ? 150 : spec.ms}ms`,
    animationTimingFunction: reduced ? 'ease' : spec.curve,
    animationFillMode: 'both',
  };
}

const kinds = Object.keys(ENTRANCES) as Entrance[];
const REGISTERED = (Platform.OS === 'web'
  ? StyleSheet.create(
      Object.fromEntries(
        kinds.flatMap((kind) => [
          [kind, entranceStyle(kind, false)],
          [`${kind}Reduced`, entranceStyle(kind, true)],
        ]),
      ) as Record<string, ViewStyle>,
    )
  : {}) as Record<string, ViewStyle>;

/**
 * One-shot entrance on mount. With reduced motion the element keeps a short
 * fade and loses the movement, which is gentler rather than nothing.
 */
export function enter(kind: Entrance, reduced: boolean): ViewStyle {
  return REGISTERED[reduced ? `${kind}Reduced` : kind] ?? {};
}

/**
 * Exits for surfaces that entered from an edge: they leave through the same
 * edge, faster than they came in.
 */
const EXITS = (Platform.OS === 'web'
  ? StyleSheet.create({
      drawer: {
        animationKeyframes: [{ from: { transform: 'none' }, to: { transform: 'translateX(-100%)' } }],
        animationDuration: '200ms',
        animationTimingFunction: easing.out,
        animationFillMode: 'forwards',
      } as ViewStyle,
      sheet: {
        animationKeyframes: [{ from: { transform: 'none' }, to: { transform: 'translateY(100%)' } }],
        animationDuration: '200ms',
        animationTimingFunction: easing.out,
        animationFillMode: 'forwards',
      } as ViewStyle,
      // The dimmed backdrop leaves with the surface, so the whole close takes
      // 200ms instead of the panel's exit followed by the Modal's own fade.
      scrim: {
        animationKeyframes: [{ from: { opacity: 1 }, to: { opacity: 0 } }],
        animationDuration: '200ms',
        animationTimingFunction: 'ease',
        animationFillMode: 'forwards',
      } as ViewStyle,
    })
  : {}) as Record<'drawer' | 'sheet' | 'scrim', ViewStyle | undefined>;

const EXIT_MS = 200;

export function exit(kind: 'drawer' | 'sheet' | 'scrim'): ViewStyle {
  return EXITS[kind] ?? {};
}

/**
 * Close a drawer or sheet after its exit has played. With reduced motion, or
 * on native where the Modal animates itself, it closes at once.
 */
export function useDismiss(close: () => void, reduced: boolean): { closing: boolean; dismiss: () => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const dismiss = useCallback(() => {
    if (reduced || Platform.OS !== 'web') {
      close();
      return;
    }
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setClosing(false);
      close();
    }, EXIT_MS);
  }, [close, reduced]);
  return { closing, dismiss };
}

/** A one-colour placeholder that breathes while content loads. */
export const skeletonPulse: ViewStyle | undefined = Platform.OS === 'web'
  ? StyleSheet.create({
      pulse: {
        animationKeyframes: [{ from: { opacity: 1 }, to: { opacity: 0.45 } }],
        animationDuration: '700ms',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
        animationDirection: 'alternate',
      } as ViewStyle,
    }).pulse
  : undefined;
