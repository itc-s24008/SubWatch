'use client';
// サブスク1件の読み込み（04-08。S-06 と S-05 の編集で共通に使う）。GET /api/subscriptions/:id（API一覧 No.6）
//
//   useSubscription(id) → { status, subscription, error, reload }
//     status：'loading'（読み込み中）／'ready'（読めた）／'notFound'（404。他人の ID・存在しない ID）／'error'（それ以外の失敗）
//     subscription：読めた値（'ready' のときだけ）
//     error：失敗のときの api() のエラー（LoadError に渡すと、共通の文〔オフライン・一時的な障害〕を優先する）
//     reload()：読み直す（［再試行］）
//   ゲートのエラー（isGateError）のときは、失敗を出さずに 'loading' のままにする（ゲートが画面を切り替える）
import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, api, isGateError } from '@/lib/api-client';
import type { SubscriptionDto, SubscriptionResponse } from '@/lib/types';

export type SubscriptionLoadStatus = 'loading' | 'ready' | 'notFound' | 'error';

export interface UseSubscriptionResult {
  status: SubscriptionLoadStatus;
  subscription: SubscriptionDto | null;
  error: unknown;
  reload: () => void;
}

export function useSubscription(id: string): UseSubscriptionResult {
  const [status, setStatus] = useState<SubscriptionLoadStatus>('loading');
  const [subscription, setSubscription] = useState<SubscriptionDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true; // 画面を離れた後・読み直した後に、古い応答で上書きしない
    setStatus('loading');
    setError(null);
    api<SubscriptionResponse>(`/api/subscriptions/${encodeURIComponent(id)}`)
      .then((data) => {
        if (!active) return;
        setSubscription(data.subscription);
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (isGateError(caught)) return;
        if (!active) return;
        setSubscription(null);
        setError(caught);
        setStatus(caught instanceof ApiClientError && caught.status === 404 ? 'notFound' : 'error');
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, subscription, error, reload };
}
