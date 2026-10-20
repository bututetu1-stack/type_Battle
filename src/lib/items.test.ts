import { describe, it, expect } from 'vitest';
import { ITEM_META, ONLINE_ITEM_META, ITEM_EMOJI, ITEM_CAT, ITEM_KIND, ITEM_DURATION } from './items';

describe('アイテム定義（単一の正）', () => {
  const ids = Object.keys(ITEM_META).sort();

  it('分類・傾向・絵文字が全アイテム分そろっている', () => {
    expect(Object.keys(ITEM_CAT).sort()).toEqual(ids);
    expect(Object.keys(ITEM_KIND).sort()).toEqual(ids);
    expect(Object.keys(ITEM_EMOJI).sort()).toEqual(ids);
  });

  it('削除したアイテムは定義に残っていない', () => {
    for (const gone of ['longbomb', 'brake', 'gaugedown', 'luck', 'totem', 'maxhp']) expect(ids).not.toContain(gone);
  });

  it('オンライン版は onlineDesc がある物だけ説明が変わる', () => {
    expect(ONLINE_ITEM_META.flood.desc).toBe(ITEM_META.flood.onlineDesc);
    expect(ONLINE_ITEM_META.flood.desc).not.toBe(ITEM_META.flood.desc);
    expect(ONLINE_ITEM_META.snipe).toEqual(ITEM_META.snipe);
  });

  it('時間制限アイテムの効果時間はすべて正の値', () => {
    for (const v of Object.values(ITEM_DURATION)) expect(v).toBeGreaterThan(0);
  });
});
