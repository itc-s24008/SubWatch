// サブスクの処理（サーバー。04-07）。サブスクをサーバーで読むときは、ここの listSubscriptions・toSubscriptionDto を使う
//
//   listSubscriptions(uid)：全件を作成日時の昇順（同じ時刻はドキュメントIDの昇順）で返す。保存の形（SubscriptionDoc）のまま
//   toSubscriptionDto(doc, today?)：API の形にする（uid を除き、日時は ISO 文字列）。nextBillingDate は請求日と周期から計算し直す
//     （保存された請求日・周期・請求日方式が壊れていて計算できないときは、500 にせず保存値を返す。API共通仕様 B14）
//   createSubscription・updateSubscription・deleteSubscription：POST・PATCH・DELETE の書き込み（transaction）
import { Timestamp, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { nextBillingDate } from '@/lib/billing';
import { todayJST } from '@/lib/clock';
import { HttpError } from '@/lib/errors';
import { adminDb } from '@/lib/firebase-admin';
import type { SubscriptionDoc, SubscriptionDto } from '@/lib/types';
import {
  checkSubscriptionField,
  duplicateKey,
  isSubscriptionId,
  validateSubscriptionCrossFields,
  type SubscriptionValues,
} from '@/lib/validation';

// 件数などの上限（統合日にそろえる名前。CLAUDE.md）
export const SUBSCRIPTION_LIMITS = { maxCount: 200 } as const;

// 1人の登録の上限。SUBSCRIPTION_LIMIT_OVERRIDE（テスト用。本番は設定しない）は 0〜199 の整数だけ有効。それ以外は 200（API共通仕様 B65）
export function subscriptionLimit(): number {
  const raw = process.env.SUBSCRIPTION_LIMIT_OVERRIDE;
  if (raw !== undefined && /^\d+$/.test(raw)) {
    const value = Number(raw);
    if (value >= 0 && value < SUBSCRIPTION_LIMITS.maxCount) return value;
  }
  return SUBSCRIPTION_LIMITS.maxCount;
}

function usersRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('users').doc(uid);
}

function subscriptionsRef(db: Firestore, uid: string) {
  return usersRef(db, uid).collection('subscriptions');
}

function millis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

// 作成日時の昇順、同じ時刻はドキュメントIDの昇順（API共通仕様 B67）
function byCreatedAt(a: SubscriptionDoc, b: SubscriptionDoc): number {
  const diff = millis(a.createdAt) - millis(b.createdAt);
  if (diff !== 0) return diff;
  return a.subscriptionId < b.subscriptionId ? -1 : a.subscriptionId > b.subscriptionId ? 1 : 0;
}

function toDoc(id: string, data: FirebaseFirestore.DocumentData): SubscriptionDoc {
  return { ...(data as SubscriptionDoc), subscriptionId: id };
}

export async function listSubscriptions(uid: string, db: Firestore = adminDb()): Promise<SubscriptionDoc[]> {
  const snapshot = await subscriptionsRef(db, uid).get();
  return snapshot.docs.map((doc) => toDoc(doc.id, doc.data())).sort(byCreatedAt);
}

function iso(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : '';
}

export function toSubscriptionDto(doc: SubscriptionDoc, today: string = todayJST()): SubscriptionDto {
  let next = doc.nextBillingDate;
  try {
    next = nextBillingDate(doc.firstBillingDate, doc.billingCycle, doc.billingDayMode, today);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return {
    subscriptionId: doc.subscriptionId,
    serviceName: doc.serviceName,
    planName: doc.planName ?? null,
    price: doc.price,
    billingCycle: doc.billingCycle,
    firstBillingDate: doc.firstBillingDate,
    nextBillingDate: next,
    billingDayMode: doc.billingDayMode,
    category: doc.category,
    trialEnabled: doc.trialEnabled === true,
    trialEndDate: doc.trialEndDate ?? null,
    websiteUrl: doc.websiteUrl ?? null,
    cancelUrl: doc.cancelUrl ?? null,
    paymentMethod: doc.paymentMethod ?? null,
    memo: doc.memo ?? null,
    subscriptionNotificationEnabled: doc.subscriptionNotificationEnabled !== false, // 項目が無いドキュメントは true
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function notFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'サブスクが見つかりません');
}

// 検査の順序 3（:id の形式と存在）。形式が違う・無い・他人のもの（uid の下に無い）は 404。Firestore に問い合わせる前に形を見る
export async function findSubscription(uid: string, id: string, db: Firestore = adminDb()): Promise<SubscriptionDoc> {
  if (!isSubscriptionId(id)) throw notFound();
  const snapshot = await subscriptionsRef(db, uid).doc(id).get();
  if (!snapshot.exists) throw notFound();
  return toDoc(snapshot.id, snapshot.data() ?? {});
}

function validationError(errors: { field: string; code: string; message: string }[]): HttpError {
  return new HttpError(400, errors[0].code, errors[0].message, { field: errors[0].field, details: errors });
}

// ---- POST /api/subscriptions ----
// users/{uid} を読む transaction の中で、同名の確認（confirmDuplicate が true なら省く）→ 件数の確認 → 保存を行う
// （同時に送られた POST を直列にし、アカウント削除の途中で書き込みが残らないようにする。API共通仕様 B62）
export async function createSubscription(
  uid: string,
  values: SubscriptionValues,
  confirmDuplicate: boolean,
  options: { db?: Firestore; today?: string } = {},
): Promise<SubscriptionDoc> {
  const db = options.db ?? adminDb();
  const today = options.today ?? todayJST();
  const now = Timestamp.now();
  const userRef = usersRef(db, uid);
  const collection = subscriptionsRef(db, uid);
  return db.runTransaction(async (tx: Transaction) => {
    const userSnapshot = await tx.get(userRef);
    if (!userSnapshot.exists) throw new HttpError(409, 'ACCOUNT_NOT_INITIALIZED');
    const existing = (await tx.get(collection)).docs.map((doc) => toDoc(doc.id, doc.data()));

    if (!confirmDuplicate) {
      const key = duplicateKey(values.serviceName);
      const candidates = existing.filter((s) => typeof s.serviceName === 'string' && duplicateKey(s.serviceName) === key).sort(byCreatedAt);
      if (candidates.length > 0) {
        throw new HttpError(409, 'DUPLICATE_CANDIDATE', `『${values.serviceName}』はすでに登録されています。別の契約として登録しますか？`, {
          candidates: candidates.map((s) => ({ subscriptionId: s.subscriptionId, serviceName: s.serviceName })),
        });
      }
    }
    // 件数は読み取った実際の数で判定する（users.subscriptionCount では判定しない）。409 のときは何も書かない
    if (existing.length >= subscriptionLimit()) throw new HttpError(409, 'SUBSCRIPTION_LIMIT_REACHED');

    const ref = collection.doc();
    const doc: SubscriptionDoc = {
      ...values,
      trialEndDate: values.trialEnabled ? values.trialEndDate : null,
      subscriptionId: ref.id,
      uid,
      nextBillingDate: nextBillingDate(values.firstBillingDate, values.billingCycle, values.billingDayMode, today),
      createdAt: now,
      updatedAt: now,
    };
    tx.set(ref, doc);
    tx.update(userRef, { subscriptionCount: existing.length + 1 }); // ずれていても直る。updatedAt は変えない
    return doc;
  });
}

// 請求日・周期・請求日方式が、保存済みの値でも正しいか（壊れていて今回の変更で直らないときは、その項目の 400。API共通仕様 B20）
const SCHEDULE_FIELDS = ['firstBillingDate', 'billingCycle', 'billingDayMode'] as const;

// ---- PATCH /api/subscriptions/:id ----
// 送られた項目だけを変える。transaction の中で読み直し（無ければ 404）、最新の値に変更を重ねた全体で項目の間を検証する（API共通仕様 B61）
export async function updateSubscription(
  uid: string,
  id: string,
  changes: Partial<SubscriptionValues>,
  options: { db?: Firestore; today?: string } = {},
): Promise<SubscriptionDoc> {
  const db = options.db ?? adminDb();
  const today = options.today ?? todayJST();
  const ref = subscriptionsRef(db, uid).doc(id);
  return db.runTransaction(async (tx: Transaction) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound();
    const current = toDoc(snapshot.id, snapshot.data() ?? {});

    const merged = { ...current, ...changes } as SubscriptionDoc;
    const scheduleErrors = SCHEDULE_FIELDS.filter((field) => !(field in changes))
      .map((field) => checkSubscriptionField(field, merged[field]))
      .flatMap((result) => (result.ok ? [] : [result.error]));
    if (scheduleErrors.length > 0) throw validationError(scheduleErrors);

    const trialEnabled = merged.trialEnabled === true;
    const crossErrors = validateSubscriptionCrossFields({
      firstBillingDate: merged.firstBillingDate,
      billingDayMode: merged.billingDayMode,
      trialEnabled,
      trialEndDate: merged.trialEndDate ?? null,
    });
    if (crossErrors.length > 0) throw validationError(crossErrors);

    const update: Record<string, unknown> = {
      ...changes,
      trialEndDate: trialEnabled ? (merged.trialEndDate ?? null) : null, // trialEnabled=false なら、送られていても null（API共通仕様 B15）
      nextBillingDate: nextBillingDate(merged.firstBillingDate, merged.billingCycle, merged.billingDayMode, today),
      updatedAt: Timestamp.now(), // 値が同じ項目だけを送ったときも書き込み、updatedAt を変える（API共通仕様 B20）
    };
    tx.update(ref, update);
    return { ...merged, ...(update as Partial<SubscriptionDoc>) };
  });
}

// ---- DELETE /api/subscriptions/:id ----
// transaction の中で users/{uid} とサブスクを読み直し、サブスクが無ければ 404（二重に減らさない）。削除と subscriptionCount の1減算を
// 同時に行う（0 未満にしない）。users が無くなっていたら、サブスクだけを削除する。通知履歴（notificationEvents）は消さない
export async function deleteSubscription(uid: string, id: string, options: { db?: Firestore } = {}): Promise<void> {
  const db = options.db ?? adminDb();
  const userRef = usersRef(db, uid);
  const ref = subscriptionsRef(db, uid).doc(id);
  await db.runTransaction(async (tx: Transaction) => {
    const userSnapshot = await tx.get(userRef);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound();
    tx.delete(ref);
    if (userSnapshot.exists) {
      const count = Number(userSnapshot.data()?.subscriptionCount ?? 0);
      tx.update(userRef, { subscriptionCount: Math.max(0, (Number.isFinite(count) ? count : 0) - 1) });
    }
  });
}
