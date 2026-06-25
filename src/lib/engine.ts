// 打鍵判定コアロジック（純粋関数）。solo / online 双方から再利用する。
import type { GameStatus, Word, WordType } from './types';

export interface PlayerState {
  backlog: Word[];
  tokenIndex: number;
  currentTyping: string;
  combo: number;
  gameState: GameStatus;
}

export interface ProcessResult {
  miss?: boolean;
  wordCleared?: boolean;
  clearedType?: WordType;
  nextState?: PlayerState;
}

// 1打鍵を処理し、結果（ミス/単語クリア/次状態）を返す。
// 「っ」「ん」のショートカットを含め、再帰的に次トークン判定も行う。
export function processKey(key: string, state: PlayerState): ProcessResult {
  const { backlog, tokenIndex, currentTyping, combo } = state;
  if (backlog.length === 0) return { miss: false };

  const word = backlog[0];
  const currentToken = word.tokens[tokenIndex];

  // 特殊処理: 「っ」のショートカット (次の文字の子音で「っ」を確定)
  if (currentTyping === '' && currentToken.kana === 'っ') {
    const nextT = word.tokens[tokenIndex + 1];
    if (nextT && nextT.romaji.some((r) => r.startsWith(key) && !['a', 'i', 'u', 'e', 'o', 'y'].includes(key))) {
      return processKey(key, { ...state, tokenIndex: tokenIndex + 1 });
    }
  }
  // 特殊処理: 「ん」のショートカット (nの次が母音/y/n以外の子音なら確定)
  if (currentTyping === 'n' && currentToken.kana === 'ん') {
    const nextT = word.tokens[tokenIndex + 1];
    if (
      nextT &&
      nextT.kana !== 'ん' &&
      nextT.romaji.some((r) => r.startsWith(key) && !['a', 'i', 'u', 'e', 'o', 'y', 'n'].includes(key))
    ) {
      return processKey(key, { ...state, tokenIndex: tokenIndex + 1, currentTyping: '' });
    }
  }

  // 通常判定
  const nextTyping = currentTyping + key;
  let isValid = false;
  let isComplete = false;

  for (const r of currentToken.romaji) {
    if (r.startsWith(nextTyping)) {
      isValid = true;
      if (r === nextTyping) isComplete = true;
      break;
    }
  }

  if (isValid) {
    if (isComplete) {
      // トークン完了
      const nextTokenIndex = tokenIndex + 1;
      if (nextTokenIndex >= word.tokens.length) {
        // 単語クリア！
        return {
          wordCleared: true,
          clearedType: word.type,
          nextState: { ...state, backlog: backlog.slice(1), tokenIndex: 0, currentTyping: '', combo: combo + 1 },
        };
      }
      // 次のトークンへ
      return { miss: false, nextState: { ...state, tokenIndex: nextTokenIndex, currentTyping: '' } };
    }
    // 入力中（前方一致）
    return { miss: false, nextState: { ...state, currentTyping: nextTyping } };
  }
  // ミス！
  return { miss: true, nextState: { ...state, combo: 0 } };
}
