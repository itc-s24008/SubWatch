// ID token の確認（機能設計書「API共通仕様」B10・B71、docs/開発ルールの詳細.md の「1. requireAuth の分け方」）
//   const user = await requireAuth(req);                        // 通常（失効は確かめない）
//   const user = await requireAuth(req, { checkRevoked: true }); // bootstrap と DELETE /api/account だけ
// verifyIdToken はテストで差し替えられる（503 の試験用。lib の差し替え口）
import type { DecodedIdToken } from 'firebase-admin/auth';
import { HttpError } from '@/lib/errors';
import { adminAuth } from '@/lib/firebase-admin';

export interface AuthUser {
  uid: string;
  email: string; // ID token の email クレーム（無ければ空文字）
  authTime: number; // ID token の auth_time（秒）
}

export type VerifyIdToken = (idToken: string, checkRevoked: boolean) => Promise<DecodedIdToken>;

export interface RequireAuthOptions {
  checkRevoked?: boolean;
  verifyIdToken?: VerifyIdToken; // テスト用の差し替え口。省略すると firebase-admin の verifyIdToken
}

// 401 UNAUTHENTICATED にする firebase-admin のエラー。表にないエラーはすべて 503（401 にしない）
export const UNAUTHENTICATED_AUTH_CODES: readonly string[] = [
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/user-not-found', // checkRevoked: true の所だけで出る
  'auth/user-disabled', // checkRevoked: true の所だけで出る
];

const defaultVerify: VerifyIdToken = (idToken, checkRevoked) => adminAuth().verifyIdToken(idToken, checkRevoked);

function errorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const withCode = error as { code?: unknown; errorInfo?: { code?: unknown } };
    if (typeof withCode.code === 'string') return withCode.code;
    if (typeof withCode.errorInfo?.code === 'string') return withCode.errorInfo.code;
  }
  return undefined;
}

// verifyIdToken の失敗を HttpError に分ける（表の code なら 401、それ以外は通信の失敗・auth/internal-error などで 503）
export function classifyVerifyError(error: unknown): HttpError {
  const code = errorCodeOf(error);
  if (code && UNAUTHENTICATED_AUTH_CODES.includes(code)) return new HttpError(401, 'UNAUTHENTICATED');
  return new HttpError(503, 'TEMPORARILY_UNAVAILABLE');
}

// Authorization: Bearer <ID token> を確かめ、uid・email・authTime を返す
// token が無い（Authorization が無い・"Bearer " で始まらない・空）は、verifyIdToken を呼ぶ前に 401
export async function requireAuth(req: Request, options: RequireAuthOptions = {}): Promise<AuthUser> {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'UNAUTHENTICATED');
  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) throw new HttpError(401, 'UNAUTHENTICATED');

  const verify = options.verifyIdToken ?? defaultVerify;
  let decoded: DecodedIdToken;
  try {
    decoded = await verify(idToken, options.checkRevoked ?? false);
  } catch (error) {
    throw classifyVerifyError(error);
  }
  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : '',
    authTime: decoded.auth_time,
  };
}
