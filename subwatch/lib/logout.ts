// ログアウトの共通処理と、サーバーを呼ばない後始末
//   logout()：registerBeforeLogout で登録した処理を最大3秒実行し、失敗しても signOut する。画面は移さない（S-02 へは Gates。S-01 は自分で移る）
//   registerLocalCleanup(fn)：サーバーを呼ばない後始末を登録する（戻り値は登録の解除。04-12 が Push 購読の解除を登録する）
//   runLocalCleanup()：登録した後始末を全部実行する。最大3秒。例外を投げない（呼ぶのは 04-05〔401〕・04-17〔削除〕）
// S-09 と S-13 のログアウトは必ず logout() を使う（アカウント削除の後は使わない。04-17）
import { signOut } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase-client';

type Task = () => unknown;

const beforeLogout = new Set<Task>();
const localCleanup = new Set<Task>();

const LIMIT_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 全部を同時に始め、全部が終わるか、ms が過ぎるかの早いほうで戻る。例外は外に出さない
async function runAllWithin(tasks: Set<Task>, ms: number): Promise<void> {
  const running = [...tasks].map((task) =>
    Promise.resolve()
      .then(task)
      .catch(() => undefined),
  );
  await Promise.race([Promise.all(running), sleep(ms)]);
}

export function registerBeforeLogout(fn: Task): () => void {
  beforeLogout.add(fn);
  return () => {
    beforeLogout.delete(fn);
  };
}

export function registerLocalCleanup(fn: Task): () => void {
  localCleanup.add(fn);
  return () => {
    localCleanup.delete(fn);
  };
}

export async function runLocalCleanup(): Promise<void> {
  try {
    await runAllWithin(localCleanup, LIMIT_MS);
  } catch {
    // 例外を投げない
  }
}

export async function logout(): Promise<void> {
  try {
    await runAllWithin(beforeLogout, LIMIT_MS);
  } catch {
    // 失敗しても signOut する
  }
  try {
    await signOut(getFirebaseAuth());
  } catch {
    // signOut の失敗も外に出さない
  }
}
