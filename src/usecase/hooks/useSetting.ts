import React from 'react';

import { getSetting, setSetting } from '~/adapter/settings';

type Updater<T> = T | ((prev: T) => T);

interface UseSettingOptions<T> {
  revive?: (stored: T) => T;
}

export const useSetting = <T>(key: string, fallback: T, options?: UseSettingOptions<T>): [T, (next: Updater<T>) => void] => {
  const revive = options?.revive;
  const [value, setValue] = React.useState<T>(fallback);

  React.useEffect(() => {
    void getSetting<T>(key, fallback).then((stored) => setValue(revive ? revive(stored) : stored));
  }, []);

  const update = React.useCallback(
    (next: Updater<T>) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        void setSetting(key, resolved);
        return resolved;
      });
    },
    [key]
  );

  return [value, update];
};
