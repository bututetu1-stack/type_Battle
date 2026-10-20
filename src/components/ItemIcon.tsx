import { Shield, Wind, Lock, Scissors, Zap } from 'lucide-react';
import { ITEM_EMOJI } from '../lib/items';
import type { ItemType } from '../lib/types';

// アイテムのアイコン（主要なものは線画アイコン、それ以外は絵文字）。ソロ/オンライン共通。
export default function ItemIcon({ type }: { type: ItemType }) {
  if (type === 'shield') return <Shield className="w-5 h-5 text-blue-300" />;
  if (type === 'clear') return <Wind className="w-5 h-5 text-cyan-300" />;
  if (type === 'keep') return <Lock className="w-5 h-5 text-fuchsia-300" />;
  if (type === 'shrink') return <Scissors className="w-5 h-5 text-emerald-300" />;
  if (type === 'parry') return <Shield className="w-5 h-5 text-violet-300" />;
  if (type === 'rapid') return <Zap className="w-5 h-5 text-yellow-300" />;
  return <span className="text-base leading-none">{ITEM_EMOJI[type]}</span>;
}
