// 画面から API を呼ぶ口（ブラウザ）。画面は必ず api() を通す（仮データへの切り替え口もここだけ）
//
//   api<T>(path, { method?, body?, skipGate?, timeoutMs? }) → data（204 のときは undefined）
//     - 呼ぶたびに currentUser.getIdToken() で ID token を取る（文字列を持ち続けない）。既定の時間切れは無い
//     - skipGate: true のときは onApiGate を呼ばない（ログアウトの途中の DELETE /api/push/subscribe だけが使う。04-12）
//     - timeoutMs の時間内に応答が無ければ通信を止め、ApiClientError（status 0、code 'TIMEOUT'）を投げる
//       （DELETE /api/account の 30000 だけが使う。setTimeout と AbortController で作る。AbortSignal.timeout は使わない）
//     - 通信できないときは status 0、code 'OFFLINE'（navigator.onLine が false）か 'NETWORK_ERROR'
//     - JSON でない応答は code 'INTERNAL_ERROR'
//   ApiClientError：status・code・field・details・candidates・requestId を持つ
//   onApiGate(listener)：401 UNAUTHENTICATED・409 TERMS_RECONSENT_REQUIRED・409 ACCOUNT_NOT_INITIALIZED のときだけ
//     listener({ status, code, method, path }) を呼ぶ（どの画面でも。S-01・S-02 でも）。戻り値は登録の解除。
//     POST /api/account/bootstrap の 409 では呼ばない（S-01・S-13 が自分で扱う。401 は呼ぶ）。知らせた後も api() は投げる
//   isGateError(error)：同じ3つのときだけ true（401 REAUTH_REQUIRED・503・ほかの 409 は false）
//   MOCKS_ENABLED：開発中に NEXT_PUBLIC_USE_MOCKS=true のとき true（api() は通信せず mocks/ の値を返す。Gates はログインを求めない）
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase-client';
import { registerLocalCleanup } from '@/lib/logout';
import type { ApiError, ApiFieldError } from '@/lib/types';
import type { MockResult } from '@/mocks/index';

export const MOCKS_ENABLED = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  readonly details?: ApiFieldError[];
  readonly candidates?: { subscriptionId: string; serviceName: string }[];
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, extras: Partial<ApiError> & { requestId?: string } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.field = extras.field;
    this.details = extras.details;
    this.candidates = extras.candidates;
    this.requestId = extras.requestId;
  }
}

export interface ApiGateEvent {
  status: number;
  code: string;
  method: string;
  path: string;
}

interface ApiJson {
  data?: unknown;
  error?: ApiError | null;
  requestId?: string;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipGate?: boolean;
  timeoutMs?: number;
}

const gateListeners = new Set<(event: ApiGateEvent) => void>();

export function onApiGate(listener: (event: ApiGateEvent) => void): () => void {
  gateListeners.add(listener);
  return () => {
    gateListeners.delete(listener);
  };
}

export function isGateError(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  if (error.status === 401) return error.code === 'UNAUTHENTICATED';
  if (error.status === 409) return error.code === 'TERMS_RECONSENT_REQUIRED' || error.code === 'ACCOUNT_NOT_INITIALIZED';
  return false;
}

function pathOnly(path: string): string {
  return path.split('?')[0];
}

function notifyGate(error: ApiClientError, method: string, path: string, skipGate: boolean): void {
  if (skipGate || !isGateError(error)) return;
  if (error.status === 409 && pathOnly(path) === '/api/account/bootstrap') return;
  const event: ApiGateEvent = { status: error.status, code: error.code, method, path };
  for (const listener of [...gateListeners]) {
    try {
      listener(event);
    } catch {
      // listener の失敗で api() の結果を変えない
    }
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// 仮データ（開発中だけ。本番のビルドでは、この分岐ごと消える）
async function callMock<T>(method: string, path: string, body: unknown, skipGate: boolean): Promise<T> {
  // import を、本番では消える分岐の中に置く（本番のビルドに mocks/ を入れないため）
  if (process.env.NODE_ENV !== 'production') {
    const { mockResponse } = await import('@/mocks/index');
    const result: MockResult = await mockResponse(method, path, body);
    if ('error' in result) {
      const error = new ApiClientError(result.status, result.error.code, result.error.message, result.error);
      notifyGate(error, method, path, skipGate);
      throw error;
    }
    if (result.status === 204 || !('data' in result)) return undefined as T;
    return result.data as T;
  }
  throw new ApiClientError(0, 'NETWORK_ERROR', '仮データは開発中だけ使えます');
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const skipGate = options.skipGate ?? false;

  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_USE_MOCKS === 'true') {
    return callMock<T>(method, path, options.body, skipGate);
  }

  const headers: Record<string, string> = {};
  const user = getFirebaseAuth().currentUser;
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      // token を取れないとき（通信の失敗など）は、送らずに呼ぶ（サーバーが 401 を返す）
    }
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  // 時間切れのタイマーは、fetch を待つ前に作る（画面テストで page.clock を進めて確かめるため）
  const controller = new AbortController();
  let timedOut = false;
  const timer =
    options.timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, options.timeoutMs)
      : null;

  let response: Response;
  let text: string;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    text = response.status === 204 ? '' : await response.text();
  } catch {
    if (timedOut) throw new ApiClientError(0, 'TIMEOUT', '応答がありませんでした');
    if (isOffline()) throw new ApiClientError(0, 'OFFLINE', 'オフラインです。接続を確認してください');
    throw new ApiClientError(0, 'NETWORK_ERROR', '通信できませんでした');
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  let json: ApiJson | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    json = parsed !== null && typeof parsed === 'object' ? (parsed as ApiJson) : null;
  } catch {
    json = null;
  }
  if (!json) {
    throw new ApiClientError(response.ok ? 500 : response.status, 'INTERNAL_ERROR', '処理に失敗しました。もう一度お試しください');
  }

  if (!response.ok || json.error) {
    const apiError = json.error ?? { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' };
    const error = new ApiClientError(response.status, apiError.code, apiError.message, {
      ...apiError,
      requestId: json.requestId,
    });
    notifyGate(error, method, path, skipGate);
    throw error;
  }
  return json.data as T;
}

// ---- 画面テスト（Playwright）用の口。開発中だけ置く（本番のビルドには入れない） ----
// window.__SUBWATCH_E2E__ = { api, onApiGate, registerLocalCleanup, signIn }
//   signIn(email)：ブラウザの Firebase Auth に、Google のアカウントとしてログインする（loginAsNewUser が /terms を開いてから呼ぶ）。
//     Auth Emulator だけが受け付ける、署名なしの Google の ID token（sub は email と同じ。tests/emulator/helpers.ts の signUpUser と同じ uid になる）
declare global {
  interface Window {
    __SUBWATCH_E2E__?: {
      api: typeof api;
      onApiGate: typeof onApiGate;
      registerLocalCleanup: typeof registerLocalCleanup;
      signIn: (email: string) => Promise<string>;
    };
  }
}

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  window.__SUBWATCH_E2E__ = {
    api,
    onApiGate,
    registerLocalCleanup,
    signIn: async (email: string) => {
      const idToken = JSON.stringify({ sub: email, email, email_verified: true });
      const credential = await signInWithCredential(getFirebaseAuth(), GoogleAuthProvider.credential(idToken));
      return credential.user.uid;
    },
  };
}
