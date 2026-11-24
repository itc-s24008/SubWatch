// API のテストの道具（Auth と Firestore の Emulator。project は demo-subwatch）
// みんなが足すファイル：自分の見出し（// ===== 04-xx：… =====）の下に足す。ほかの人の行と、先頭の import は変えない
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import type { RouteContext } from '@/lib/http';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-subwatch';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

let counter = 0;

// Auth Emulator にユーザーを作る。→ { uid, email, password, token }（token は ID token）
export async function signUpUser(): Promise<{ uid: string; email: string; password: string; token: string }> {
  counter += 1;
  const email = `user${Date.now()}${counter}@example.com`;
  const password = 'password1234';
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`Auth Emulator の signUp に失敗しました（${res.status}）`);
  const json = (await res.json()) as { localId: string; idToken: string };
  return { uid: json.localId, email, password, token: json.idToken };
}

// ユーザーを作り、ID token だけを返す
export async function signUp(): Promise<string> {
  return (await signUpUser()).token;
}

// ID token から uid を取り出す（署名は確かめない。テスト用）
export function uidOf(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { user_id?: string; sub?: string };
  const uid = payload.user_id ?? payload.sub;
  if (!uid) throw new Error('token に uid がありません');
  return uid;
}

export interface CallRouteOptions {
  method?: string; // 既定 'GET'
  token?: string; // あれば Authorization: Bearer <token>
  body?: unknown; // JSON にして送る（Content-Type: application/json を付ける）
  rawBody?: string; // そのまま送る（JSON でない本文のテスト用。Content-Type は headers で決める）
  params?: Record<string, string>; // :id など（route の第2引数の params）
  path?: string; // 既定 '/api/test'（クエリを付けてよい）
  headers?: Record<string, string>; // 足すヘッダー（同じ名前は上書き）
}

type AnyRoute = (req: Request, ctx: RouteContext<any>) => Promise<Response>; // eslint-disable-line @typescript-eslint/no-explicit-any

// route handler を直接呼ぶ。→ { status, body }（body は { data, error, requestId }。値は body.data。204 のときは null）
export async function callRoute(
  handler: AnyRoute,
  options: CallRouteOptions = {},
): Promise<{ status: number; body: { data: any; error: any; requestId: string } | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  Object.assign(headers, options.headers ?? {});
  const method = options.method ?? 'GET';
  const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  const req = new Request(`http://localhost${options.path ?? '/api/test'}`, { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(options.params ?? {}) });
  const text = res.status === 204 ? '' : await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// users/{uid} を作る（bootstrap を通さない）。fields で項目を上書きできる。規約の版の既定は環境変数の現行の版
export async function seedUser(uid: string, fields: Record<string, unknown> = {}): Promise<void> {
  const now = Timestamp.now();
  const termsVersion = process.env.NEXT_PUBLIC_TERMS_VERSION ?? '';
  const privacyVersion = process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '';
  await adminDb()
    .collection('users')
    .doc(uid)
    .set({
      uid,
      email: `${uid}@example.com`,
      subscriptionCount: 0,
      accountNotificationEnabled: true,
      termsAcceptedAt: now,
      termsVersion,
      privacyVersion,
      consentHistory: [{ termsVersion, privacyVersion, acceptedAt: now, kind: 'create' }],
      createdAt: now,
      updatedAt: now,
      ...fields,
    });
}

// Emulator のデータを全部消す（Firestore のドキュメントと Auth のユーザー）
export async function resetEmulators(): Promise<void> {
  const firestore = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  if (!firestore.ok) throw new Error(`Firestore Emulator のリセットに失敗しました（${firestore.status}）`);
  const auth = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
  if (!auth.ok) throw new Error(`Auth Emulator のリセットに失敗しました（${auth.status}）`);
}

// ===== 04-07：seedSubscriptions・TEST_DATA_SUBSCRIPTIONS ここに足す =====

// ===== 04-12：seedPushSubscription ここに足す =====

// ===== 04-14：seedNotificationEvents・cronAuthHeaders ここに足す =====
