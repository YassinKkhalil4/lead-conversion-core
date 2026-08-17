import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rolefit.queue.last-look';

/**
 * When the queue was last opened, stored on the device.
 *
 * The value read on mount is the *previous* visit, and the current visit is
 * written straight afterwards. That is what lets the queue draw a line between
 * what has changed since you last looked and what has not — this is opened
 * thirty times a day, and "what is new" is most of the question.
 */
export function useLastLook(): { previousLook: number | null; markLooked: () => void } {
  const [previousLook, setPreviousLook] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(KEY);
        if (!cancelled) setPreviousLook(stored ? Number(stored) : null);
      } catch {
        if (!cancelled) setPreviousLook(null);
      }
      try {
        await AsyncStorage.setItem(KEY, String(Date.now()));
      } catch {
        // A device that cannot persist this simply never shows the divider.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markLooked = useCallback(() => {
    void AsyncStorage.setItem(KEY, String(Date.now())).catch(() => undefined);
  }, []);

  return { previousLook, markLooked };
}
