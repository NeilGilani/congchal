import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useSettings } from './useStore';

/** True if the OS asks for reduced motion or the user chose "always" in Settings. */
export const useReducedMotion = (): boolean => {
  const { settings } = useSettings();
  const [system, setSystem] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setSystem(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystem);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return settings.reduceMotion === 'always' || system;
};
