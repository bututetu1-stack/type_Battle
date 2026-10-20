import { describe, it, expect, beforeEach } from 'vitest';
import { loadKeyConfig, defaultKeyConfig, RESTART_CODE } from './keyconfig';

// テスト環境（Node）には localStorage が無いので最小限の代用品を置く。
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

describe('キー設定', () => {
  beforeEach(() => store.clear());

  it('狙いの切替の既定は左Shift（Tab はリスタート専用）', () => {
    expect(RESTART_CODE).toBe('Tab');
    expect(defaultKeyConfig().target).toBe('ShiftLeft');
  });

  it('以前の設定で Tab が割り当てられていたら既定へ移行する', () => {
    store.set('typeRoyale.keys', JSON.stringify({ target: 'Tab', cycle: 'Tab', fire: 'Enter' }));
    const c = loadKeyConfig();
    expect(c.target).toBe('ShiftLeft');
    expect(c.cycle).toBe('Space');
    expect(c.fire).toBe('Enter');
  });

  it('Tab 以外の自分で決めたキーはそのまま残す', () => {
    store.set('typeRoyale.keys', JSON.stringify({ target: 'KeyQ' }));
    expect(loadKeyConfig().target).toBe('KeyQ');
  });
});
