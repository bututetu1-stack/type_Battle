import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 初回表示を軽く保つための見張り。ホーム（App.tsx）とホームが直接読むモジュールが、
// 重いもの（単語辞書 words.ts・Firebase SDK・ゲーム画面）を「静的に」import すると、
// ホームを出す前にそれらを全部読み込むことになり、表示が 0.5 秒ほど遅くなる（CLAUDE.md「ハマりどころ」）。
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
// import … from と export … from（再公開）の両方。引用符は ' と " のどちらでも。
const staticImports = (code: string) => [...code.matchAll(/^(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const HEAVY = [/\/words$/, /\/firebase$/, /\/room$/, /\/leaderboard$/, /^firebase\//, /\/SoloGame$/, /\/OnlineGame$/, /\/OnlineRoom$/, /\/Lobby$/];

describe('初回表示で読むモジュール', () => {
  // ホームが表示される前に読まれるファイル（App.tsx と、そこから静的に import されるもの）
  for (const file of ['App.tsx', 'main.tsx', 'lib/customwords.ts', 'lib/firebaseEnv.ts', 'components/PlayerSettings.tsx']) {
    it(`${file} は重いモジュールを静的に import しない`, () => {
      const heavy = staticImports(src(file)).filter((m) => HEAVY.some((re) => re.test(m)));
      expect(heavy).toEqual([]);
    });
  }
});
