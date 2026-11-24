// テスト（vitest の2本と Playwright）が読む環境変数。subwatch/.env.development.local（.env.development.example をコピーしたもの。
// Emulator 用のダミーの値）を読んで process.env に入れる。.env.local は読まない（本物の鍵を置かないため。読む処理もここに作らない）
// すでに process.env にある値は上書きしない（コマンドで渡した値を優先する）
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadDevEnv(root: string = process.cwd()): void {
  const file = path.join(root, '.env.development.local');
  if (!existsSync(file)) {
    throw new Error('subwatch/.env.development.local がありません。cp ../設定ファイル/.env.development.example .env.development.local で作ってください');
  }
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDevEnv();
