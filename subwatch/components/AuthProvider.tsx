'use client';
// ログインの状態（枠は 04-01、中身は 04-05 が書く。04-12 は import を1行だけ足す）
//   useAuth() → { user, loading }（user は未ログインなら null）
//   useAccountGate() は 04-05 が足す（Gates が読んだ GET /api/account の値と、同意が必要かの状態）
import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { MOCKS_ENABLED } from '@/lib/api-client'; // 画面テストの口（window.__SUBWATCH_E2E__）も、この import で置かれる
import { getFirebaseAuth } from '@/lib/firebase-client';

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

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// ===== 04-05：useAccountGate と、onApiGate の受け方 ここに足す =====
