// アカウントの共通処理（サーバー）。requireInitialized は共通ファイル（04-01 だけが変える）
// みんなが足すファイル：自分の見出し（// ===== 04-xx：… =====）の下に足す。ほかの人の行と、先頭の import は変えない
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { HttpError } from '@/lib/errors';
import { adminDb } from '@/lib/firebase-admin';
import { isTermsCurrent } from '@/lib/terms';
import type { ConsentRecord } from '@/lib/types';

// users/{uid}（DB設計書 テーブルNo.1 の物理名）
export interface UserDoc {
  uid: string;
  email: string; // ID token に email クレームが無ければ空文字
  subscriptionCount: number; // 0〜200。監査とテストのための値（画面の登録数・上限の判定には使わない）
  accountNotificationEnabled: boolean; // 項目が無いドキュメントは true として扱う
  termsAcceptedAt: Timestamp;
  termsVersion: string;
  privacyVersion: string;
  consentHistory: ConsentRecord[]; // 追記だけ。最大20件
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RequireInitializedOptions {
  checkTerms?: boolean; // 既定 true。規約の版を調べない API（GET /api/account・DELETE /api/push/subscribe など）は false
  db?: Firestore; // テスト用の差し替え口
}

// 検査の順序 2・2b（API共通仕様 B6）：users/{uid} が無ければ 409 ACCOUNT_NOT_INITIALIZED、
// 保存された規約の版が現行と違えば 409 TERMS_RECONSENT_REQUIRED。読んだ users を返す（route でもう一度読まなくてよい）
export async function requireInitialized(uid: string, options: RequireInitializedOptions = {}): Promise<UserDoc> {
  const db = options.db ?? adminDb();
  const snapshot = await db.collection('users').doc(uid).get();
  if (!snapshot.exists) throw new HttpError(409, 'ACCOUNT_NOT_INITIALIZED');
  const user = snapshot.data() as UserDoc;
  if ((options.checkTerms ?? true) && !isTermsCurrent(user)) throw new HttpError(409, 'TERMS_RECONSENT_REQUIRED');
  return user;
}

// ===== 04-05：bootstrap・GET /api/account の処理 ここに足す =====
import { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { currentTermsVersions } from '@/lib/terms';
import type { AccountDto, BootstrapBody, BootstrapResult } from '@/lib/types';

export const BOOTSTRAP_KEYS = ['termsAccepted', 'privacyAccepted', 'termsVersion', 'privacyVersion'] as const;
export const CONSENT_HISTORY_LIMIT = 20; // consentHistory は最大20件（超えたら古いものから消す）

// bootstrap の本文の検査（API共通仕様 B69）：本文の検査（400）→ 版の一致（409）の順。
// details の順は termsAccepted → privacyAccepted → termsVersion → privacyVersion。message は「入力内容を確認してください」
// （要件定義書の入力項目の表に無い項目。API共通仕様 B57）。版が文字列でも現行と違う（空文字を含む）ときは 409。
// 環境変数の版が未設定・空のときは、いつも 409
export function validateBootstrapBody(body: Record<string, unknown>): BootstrapBody {
  const message = '入力内容を確認してください';
  const details: { field: string; code: string; message: string }[] = [];
  if (body.termsAccepted !== true) details.push({ field: 'termsAccepted', code: 'VALIDATION_ERROR', message });
  if (body.privacyAccepted !== true) details.push({ field: 'privacyAccepted', code: 'VALIDATION_ERROR', message });
  if (typeof body.termsVersion !== 'string') details.push({ field: 'termsVersion', code: 'VALIDATION_ERROR', message });
  if (typeof body.privacyVersion !== 'string') details.push({ field: 'privacyVersion', code: 'VALIDATION_ERROR', message });
  if (details.length > 0) throw new HttpError(400, 'VALIDATION_ERROR', message, { field: details[0].field, details });

  const current = currentTermsVersions();
  if (!current.termsVersion || !current.privacyVersion) throw new HttpError(409, 'TERMS_RECONSENT_REQUIRED');
  if (body.termsVersion !== current.termsVersion || body.privacyVersion !== current.privacyVersion) {
    throw new HttpError(409, 'TERMS_RECONSENT_REQUIRED');
  }
  return { termsAccepted: true, privacyAccepted: true, termsVersion: current.termsVersion, privacyVersion: current.privacyVersion };
}

export interface BootstrapOptions {
  db?: Firestore; // テスト用の差し替え口
  now?: () => Timestamp; // テスト用の差し替え口（acceptedAt を作る時刻）
}

// users/{uid} を作る・版を更新する（詳細_F-01 の手順5、API共通仕様 B69、決まりの一覧 C-11）
//   無い → 作る（consentHistory に kind 'create' を1件）。版が現行と同じ → 何もしない。版が古い → 版・同意日時・updatedAt を更新し、
//   consentHistory に kind 'reconsent' を1件足す（最大20件。email と subscriptionCount は変えない）
//   acceptedAt は transaction の前に Timestamp.now() で1回だけ作り、termsAcceptedAt にも同じ値を入れる（配列の中で serverTimestamp を使わない）
export async function bootstrapAccount(
  uid: string,
  email: string,
  versions: { termsVersion: string; privacyVersion: string },
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const db = options.db ?? adminDb();
  const acceptedAt = options.now ? options.now() : AdminTimestamp.now();
  const ref = db.collection('users').doc(uid);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      const record: ConsentRecord = { ...versions, acceptedAt, kind: 'create' };
      const doc: UserDoc = {
        uid,
        email,
        subscriptionCount: 0,
        accountNotificationEnabled: true,
        termsAcceptedAt: acceptedAt,
        termsVersion: versions.termsVersion,
        privacyVersion: versions.privacyVersion,
        consentHistory: [record],
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      };
      tx.set(ref, doc);
      return;
    }
    const user = snapshot.data() as Partial<UserDoc>;
    if (user.termsVersion === versions.termsVersion && user.privacyVersion === versions.privacyVersion) return; // 同じなら何もしない
    const record: ConsentRecord = { ...versions, acceptedAt, kind: 'reconsent' };
    const history = Array.isArray(user.consentHistory) ? user.consentHistory : [];
    tx.update(ref, {
      termsVersion: versions.termsVersion,
      privacyVersion: versions.privacyVersion,
      termsAcceptedAt: acceptedAt,
      updatedAt: acceptedAt,
      consentHistory: [...history, record].slice(-CONSENT_HISTORY_LIMIT),
    });
  });
  return { uid, initialized: true };
}

// GET /api/account の中身（API一覧 No.2、API共通仕様 B9・B23）。users/{uid} が無ければ 404 NOT_FOUND。
// 規約の版は調べない。webPushSubscriptions を1回読み（count() 集計は使わない）、件数と ID（ドキュメントID の昇順。読んだ全部）を返す
export async function getAccount(uid: string, options: { db?: Firestore } = {}): Promise<AccountDto> {
  const db = options.db ?? adminDb();
  const ref = db.collection('users').doc(uid);
  const [snapshot, pushSnapshot] = await Promise.all([ref.get(), ref.collection('webPushSubscriptions').get()]);
  if (!snapshot.exists) throw new HttpError(404, 'NOT_FOUND');
  const user = snapshot.data() as Partial<UserDoc>;
  const pushSubscriptionIds = pushSnapshot.docs.map((doc) => doc.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    email: typeof user.email === 'string' ? user.email : '',
    accountNotificationEnabled: user.accountNotificationEnabled !== false, // 項目が無いドキュメントは true
    termsVersion: typeof user.termsVersion === 'string' ? user.termsVersion : '',
    privacyVersion: typeof user.privacyVersion === 'string' ? user.privacyVersion : '',
    pushSubscriptionCount: pushSubscriptionIds.length,
    pushSubscriptionIds,
  };
}

// ===== 04-07：サブスクの登録・削除（users/{uid} を読む transaction）に要る処理 ここに足す =====

// ===== 04-21：PATCH /api/account の処理 ここに足す =====
// PATCH /api/account（API一覧 No.3、詳細_F-12 の手順5、API共通仕様 B9・B56・B106、決まりの一覧 C-8）
//   users/{uid} の確認（無ければ 409 ACCOUNT_NOT_INITIALIZED）と規約の版の確認は、route が requireInitialized で先に行う
//   保存された値と同じなら、何も書かずに同じ値を返す（updatedAt も変えない。項目が無いドキュメントは true として比べる）
//   変えるときは update で accountNotificationEnabled と updatedAt だけを書く（set や merge で users を作り直さない）。
//   読んだ後に users が消えていた（update が NOT_FOUND）ときは 409 ACCOUNT_NOT_INITIALIZED
import { isFirestoreNotFound } from '@/lib/errors';
import type { UpdateAccountBody, UpdateAccountResult } from '@/lib/types';

export const UPDATE_ACCOUNT_KEYS = ['accountNotificationEnabled'] as const;

// 本文の項目の検査：accountNotificationEnabled が真偽値でない（無い・null・文字列など）なら 400 VALIDATION_ERROR
// （要件定義書の入力項目の表に無い項目なので、message は「入力内容を確認してください」。API共通仕様 B39）
export function validateUpdateAccountBody(body: Record<string, unknown>): UpdateAccountBody {
  if (typeof body.accountNotificationEnabled !== 'boolean') {
    const message = '入力内容を確認してください';
    throw new HttpError(400, 'VALIDATION_ERROR', message, {
      field: 'accountNotificationEnabled',
      details: [{ field: 'accountNotificationEnabled', code: 'VALIDATION_ERROR', message }],
    });
  }
  return { accountNotificationEnabled: body.accountNotificationEnabled };
}

export interface UpdateAccountOptions {
  db?: Firestore; // テスト用の差し替え口
  now?: () => Timestamp; // テスト用の差し替え口（updatedAt の時刻）
}

export async function updateAccountNotification(
  uid: string,
  user: UserDoc,
  accountNotificationEnabled: boolean,
  options: UpdateAccountOptions = {},
): Promise<UpdateAccountResult> {
  const saved = (user as Partial<UserDoc>).accountNotificationEnabled !== false; // 項目が無いドキュメントは true
  if (saved === accountNotificationEnabled) return { accountNotificationEnabled };
  const db = options.db ?? adminDb();
  const updatedAt = options.now ? options.now() : AdminTimestamp.now();
  try {
    await db.collection('users').doc(uid).update({ accountNotificationEnabled, updatedAt });
  } catch (error) {
    if (isFirestoreNotFound(error)) throw new HttpError(409, 'ACCOUNT_NOT_INITIALIZED');
    throw error;
  }
  return { accountNotificationEnabled };
}
