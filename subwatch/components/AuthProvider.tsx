'use client';
// ログインの状態（枠は 04-01、中身は 04-05 が書く。04-12 は import を1行だけ足す）
//   useAuth() → { user, loading }（user は未ログインなら null）
//   useAccountGate() は 04-05 が足す（Gates が読んだ GET /api/account の値と、同意が必要かの状態）
import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { MOCKS_ENABLED } from '@/lib/api-client'; // 画面テストの口（window.__SUBWATCH_E2E__）も、この import で置かれる
import { getFirebaseAuth } from '@/lib/firebase-client';
import '@/lib/push-client'; // 04-12：ログアウト・401 の後始末で、この端末の Push 購読を解除する処理を登録する

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: !MOCKS_ENABLED });

  useEffect(() => {
    if (MOCKS_ENABLED) return; // 仮データのときはログインを求めない
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      setState({ user, loading: false });
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={state}>
      <AccountGateProvider uid={state.user?.uid ?? null}>{children}</AccountGateProvider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// ===== 04-05：useAccountGate と、onApiGate の受け方 ここに足す =====
// useAccountGate() → { status, account, error, loadAccount }
//   Gates が読んだ GET /api/account の値（account）と、同意が必要かの状態（status）。ログインした人（uid）が変わると 'idle' に戻る
//   status：'idle'（まだ読んでいない）／'loading'（読んでいる）／'ready'（users があり、規約の版が現行と同じ）／
//           'consent'（404・版が古い・API が 409 TERMS_RECONSENT_REQUIRED か ACCOUNT_NOT_INITIALIZED を返した。S-13 を出す）／
//           'error'（読めなかった。error に api() のエラー。Gates が共通の読み込み失敗と［再試行］を出す）
//   loadAccount()：GET /api/account を読み直す（Gates が最初の1回・［再試行］・S-13 の onDone で呼ぶ）
// onApiGate の受け方（どの画面でも。S-01・S-02 でも）：
//   401 UNAUTHENTICATED → runLocalCleanup()（サーバーを呼ばない後始末。最大3秒）→ setFlash（期限切れの文。signOut の前）→
//     signOut だけ（logout() は API を呼ぶので使わない）→ S-02 へ router.replace
//   409 TERMS_RECONSENT_REQUIRED・ACCOUNT_NOT_INITIALIZED → status を 'consent' にする（Gates が S-13 を出す。(auth) の画面には Gates が無い）
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';
import { AUTH_MESSAGES } from '@/lib/auth-flow';
import { ApiClientError, api, isGateError, onApiGate } from '@/lib/api-client';
import { setFlash } from '@/lib/flash';
import { runLocalCleanup } from '@/lib/logout';
import { isTermsCurrent } from '@/lib/terms';
import type { AccountDto } from '@/lib/types';

export type AccountGateStatus = 'idle' | 'loading' | 'ready' | 'consent' | 'error';

export interface AccountGateState {
  status: AccountGateStatus;
  account: AccountDto | null;
  error: unknown;
  loadAccount: () => Promise<void>;
}

const AccountGateContext = createContext<AccountGateState>({
  status: 'idle',
  account: null,
  error: null,
  loadAccount: async () => undefined,
});

type GateValues = Omit<AccountGateState, 'loadAccount'>;
const IDLE: GateValues = { status: 'idle', account: null, error: null };

function AccountGateProvider({ uid, children }: { uid: string | null; children: ReactNode }) {
  const router = useRouter();
  const [values, setValues] = useState<GateValues>(IDLE);
  const seqRef = useRef(0); // 古い読み込みの結果で上書きしないための番号
  const uidRef = useRef<string | null>(uid);
  const expiringRef = useRef(false);

  // ログインした人が変わったら、読み直す（Gates は、ログインした人ごとに最初に1回読む）
  if (uidRef.current !== uid) {
    uidRef.current = uid;
    seqRef.current += 1;
    if (values !== IDLE) setValues(IDLE);
  }

  const loadAccount = useCallback(async () => {
    seqRef.current += 1;
    const seq = seqRef.current;
    setValues((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const account = await api<AccountDto>('/api/account');
      if (seq !== seqRef.current) return;
      setValues({ status: isTermsCurrent(account) ? 'ready' : 'consent', account, error: null });
    } catch (error) {
      if (seq !== seqRef.current) return;
      if (error instanceof ApiClientError && error.status === 404) {
        setValues({ status: 'consent', account: null, error: null }); // users が無い → S-13
        return;
      }
      if (isGateError(error)) return; // 401 は S-02 へ、409 は 'consent'（onApiGate の受け方）。文は出さない
      setValues((prev) => ({ ...prev, status: 'error', error }));
    }
  }, []);

  useEffect(() => {
    const expire = async () => {
      if (expiringRef.current) return;
      expiringRef.current = true;
      try {
        await runLocalCleanup(); // 例外を投げない。最大3秒
        setFlash(AUTH_MESSAGES.flashExpired); // signOut の前に置く（決まりの一覧 C-14）
        try {
          await signOut(getFirebaseAuth());
        } catch {
          // サインアウトの失敗でも S-02 へ移す
        }
        router.replace('/login');
      } finally {
        expiringRef.current = false;
      }
    };
    return onApiGate((event) => {
      if (event.status === 401) {
        void expire();
        return;
      }
      seqRef.current += 1; // 読んでいる途中の結果で 'ready' に戻さない
      setValues((prev) => ({ ...prev, status: 'consent', error: null }));
    });
  }, [router]);

  const value = useMemo<AccountGateState>(() => ({ ...values, loadAccount }), [values, loadAccount]);
  return <AccountGateContext.Provider value={value}>{children}</AccountGateContext.Provider>;
}

export function useAccountGate(): AccountGateState {
  return useContext(AccountGateContext);
}
