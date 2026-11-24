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

// ===== 04-07：サブスクの登録・削除（users/{uid} を読む transaction）に要る処理 ここに足す =====

// ===== 04-21：PATCH /api/account の処理 ここに足す =====
