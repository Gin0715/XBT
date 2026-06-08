import { useState, useEffect, useCallback } from 'react';
import { getBMapKey, hasBMapKey, clearBMapKey as clearFromStorage, reloadBMapWithKey } from '../utils/bmap';

/** 自定义事件名，用于同页面内跨组件同步 key 变更 */
const BMAP_KEY_CHANGED = 'xbt-bmap-key-changed';

/**
 * 响应式百度地图 Key 管理 Hook
 *
 * - 在 localStorage 变化时自动同步（跨标签页）
 * - 通过自定义事件同步同页面内不同组件
 * - 提供便捷的 set/clear/reload 方法
 */
export function useBMapKey() {
  const [key, setRawKey] = useState(getBMapKey);
  const [saving, setSaving] = useState(false);

  const configured = hasBMapKey();

  // 监听 storage 变化（跨标签页同步）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'baidu_map_key' || e.key === null) {
        setRawKey(getBMapKey());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 监听同页面自定义事件
  useEffect(() => {
    const onChanged = () => setRawKey(getBMapKey());
    window.addEventListener(BMAP_KEY_CHANGED, onChanged);
    return () => window.removeEventListener(BMAP_KEY_CHANGED, onChanged);
  }, []);

  // 通知同页面其他组件 key 已变更
  const notify = useCallback(() => {
    window.dispatchEvent(new CustomEvent(BMAP_KEY_CHANGED));
  }, []);

  /** 保存 key 到 localStorage 并重新加载 SDK */
  const save = useCallback(async (newKey: string): Promise<boolean> => {
    if (!newKey.trim()) return false;
    setSaving(true);
    try {
      const ok = await reloadBMapWithKey(newKey.trim());
      setRawKey(getBMapKey());
      notify();
      return ok;
    } finally {
      setSaving(false);
    }
  }, [notify]);

  /** 清除 key */
  const clear = useCallback(async () => {
    clearFromStorage();
    setRawKey('');
    notify();
    await reloadBMapWithKey('');
  }, [notify]);

  return { key, configured, saving, save, clear } as const;
}
