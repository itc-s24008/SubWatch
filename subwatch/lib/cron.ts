// 日次 Cron（F-06・F-08 の通知。04-14）。機能設計書 詳細_F-06、API共通仕様 B26・B85〜B89・B106、DB設計書 3.補足設計 B18・B19
//
//   verifyCronSecret(req)：Authorization: Bearer CRON_SECRET を確かめる（違えば 401 INVALID_CRON_SECRET）
//   resolveRunDate(req, now?)：runDate（日本時間の今日。ALLOW_CRON_RUNDATE_OVERRIDE が 'true' のときだけ ?runDate を使う）
//   runDailyCron(options)：cronRuns の確認 → refresh_stale → candidates → events → push → cleanup → 記録。CronResult を返す
//   noopPushSender：11/25 の統合までの仮の PushSender（何も送らず、何も保存せずに skipped を返す）
//
// Cron と PushSender の分担（lib/types.ts の PushSender。詳細_F-06 の 8-6）：
//   Cron は、送る通知イベントを選ぶ・締切を確かめる（利用者ごとの前と、通知イベント1件の送信の前）・PushSender を呼ぶ・
//   戻り値の status で sentCount（sent・partially_sent）と failedCount（failed）を数える、まで。
//   購読の読み取りと削除、webPushDeliveredIds・webPushStatus・webPushSentAt・webPushLastErrorCode の保存は PushSender（04-15）が行う
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { addDays, isValidDate, nextBillingDate } from '@/lib/billing';
import { todayJST } from '@/lib/clock';
import { ERROR_MESSAGES, HttpError, fromFirestoreError } from '@/lib/errors';
import { adminDb } from '@/lib/firebase-admin';
import { notificationId, planNotifications } from '@/lib/notifications';
import type {
  CronResult,
  CronRunDoc,
  DateString,
  NotificationEvent,
  NotificationEventDoc,
  PushResult,
  PushSender,
  SubscriptionDoc,
} from '@/lib/types';

// ---- 決まった数 ----
export const CRON_DEADLINE_MS = 240_000; // 内部締切 240秒（関数の最大実行時間は 300秒。vercel.json）
export const CRON_RUNNING_STALE_MS = 10 * 60 * 1000; // running のまま10分以上は、止まったものとみなす
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // expireAt は createdAt・startedAt の90日後

export interface CronLimits {
  refreshBatchSize: number; // refresh_stale の1回の取得（200件）
  refreshMaxRounds: number; // refresh_stale の最大の回数（50回）
  cleanupBatchSize: number; // cleanup の1回の削除（500件）
  cleanupMaxRounds: number; // cleanup の1回の実行での最大の回数（10回）
}
export const CRON_LIMITS: CronLimits = { refreshBatchSize: 200, refreshMaxRounds: 50, cleanupBatchSize: 500, cleanupMaxRounds: 10 };

// ---- 認証と runDate（API共通仕様 B87） ----

function sha256(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

// Authorization: Bearer {CRON_SECRET}。timingSafeEqual で比べる（長さを揃えるため、両方の sha256 を比べる）。CRON_SECRET が未設定なら常に 401
export function verifyCronSecret(req: Request, secret: string | undefined = process.env.CRON_SECRET): void {
  const header = req.headers.get('authorization') ?? '';
  if (!secret || !timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`))) {
    throw new HttpError(401, 'INVALID_CRON_SECRET');
  }
}

// runDate：日本時間の今日。ALLOW_CRON_RUNDATE_OVERRIDE が文字列 'true' のときだけ ?runDate を使う（'TRUE'・'1' などは無視）。
// 不正な日付（?runDate= の空、形が違う、実在しない、2000-01-01〜2100-12-31 の外）は 400 INVALID_DATE（field=runDate）。
// runDate 以外のクエリ（?slot=2 など）は読まない（400 にしない）
export function resolveRunDate(req: Request, now: Date = new Date(), allowOverride = process.env.ALLOW_CRON_RUNDATE_OVERRIDE): DateString {
  if (allowOverride !== 'true') return todayJST(now);
  const value = new URL(req.url).searchParams.get('runDate');
  if (value === null) return todayJST(now);
  if (!isValidDate(value) || value < '2000-01-01' || value > '2100-12-31') {
    const message = ERROR_MESSAGES.INVALID_DATE;
    throw new HttpError(400, 'INVALID_DATE', message, { field: 'runDate', details: [{ field: 'runDate', code: 'INVALID_DATE', message }] });
  }
  return value;
}

// ---- 仮の PushSender ----
// 11/25 の統合までは、route がこれを渡す。統合で、04-15 の lib/push.ts が export する pushSender に差し替える（route の1か所）
export const noopPushSender: PushSender = async (_uid, event) => ({
  status: 'skipped',
  deliveredIds: [...event.webPushDeliveredIds],
  lastErrorCode: null,
});

// ---- cleanup の繰り返しの判定（tests/unit/cleanup.test.ts で確かめる） ----

export interface CleanupLoopResult {
  deleted: number; // 削除した件数の合計
  rounds: number; // 削除を行った回数
  stoppedByDeadline: boolean; // 締切で止めたか
  error: unknown; // 削除に失敗したとき、そのエラー（失敗したら、そこで止める）
}

// deleteBatch(limit) を、削除した件数が limit に達している間だけ繰り返す（最大 maxRounds 回）。
// 各回（1回目を含む）の前に isPastDeadline() を確かめ、過ぎていたら止める。失敗しても例外にせず、それまでの件数を返す
export async function runCleanupLoop(
  deleteBatch: (limit: number) => Promise<number>,
  isPastDeadline: () => boolean,
  options: { batchSize?: number; maxRounds?: number } = {},
): Promise<CleanupLoopResult> {
  const batchSize = options.batchSize ?? CRON_LIMITS.cleanupBatchSize;
  const maxRounds = options.maxRounds ?? CRON_LIMITS.cleanupMaxRounds;
  const result: CleanupLoopResult = { deleted: 0, rounds: 0, stoppedByDeadline: false, error: null };
  while (result.rounds < maxRounds) {
    if (isPastDeadline()) {
      result.stoppedByDeadline = true;
      break;
    }
    let count: number;
    try {
      count = await deleteBatch(batchSize);
    } catch (error) {
      result.error = error;
      break;
    }
    result.rounds += 1;
    result.deleted += count;
    if (count < batchSize) break;
  }
  return result;
}

// ---- 本体 ----

export interface RunDailyCronOptions {
  runDate: DateString; // 日本時間の今日（route が resolveRunDate で決める）
  pushSender: PushSender; // Push の送信（テストでは偽物を渡す。統合までは noopPushSender）
  db?: Firestore; // テスト用の差し替え口
  now?: () => Date; // 現在時刻（startedAt・createdAt・cleanup の基準・締切の判定。テスト用の差し替え口）
  deadlineAt?: number; // 締切の時刻（ミリ秒）。省略すると、始めた時刻＋240秒（テスト用の差し替え口。partial の試験用）
  limits?: Partial<CronLimits>; // テスト用（件数の上限を小さくして、打ち切りと繰り返しを試す）
  hooks?: { beforeCreateEvent?: (uid: string, notificationId: string) => Promise<void> }; // テスト用（作成の直前に users を消す試験）
}

type RunStatus = 'completed' | 'partial';

class DeadlineReached extends Error {}

interface Candidate {
  uid: string;
  subscription: SubscriptionDoc;
}

interface PushTarget {
  uid: string;
  event: NotificationEvent;
}

function uidOf(ref: DocumentReference): string | null {
  // users/{uid}/subscriptions/{subscriptionId}
  const parent = ref.parent.parent;
  return parent && parent.parent.id === 'users' ? parent.id : null;
}

function toNotificationEvent(data: FirebaseFirestore.DocumentData): NotificationEvent {
  return {
    notificationId: data.notificationId,
    uid: data.uid,
    subscriptionId: data.subscriptionId,
    serviceNameAtNotification: data.serviceNameAtNotification,
    notificationType: data.notificationType,
    daysBefore: data.daysBefore,
    targetDate: data.targetDate,
    title: data.title,
    body: data.body,
    priceAtNotification: data.priceAtNotification ?? null,
    webPushStatus: data.webPushStatus,
    webPushDeliveredIds: Array.isArray(data.webPushDeliveredIds) ? [...data.webPushDeliveredIds] : [],
  };
}

// cronRuns の errorCode に入れるコード（DB設計書 No.5 の4種）
function errorCodeOf(error: HttpError): CronRunDoc['errorCode'] {
  const codes: CronRunDoc['errorCode'][] = ['CONFLICT', 'RESOURCE_EXHAUSTED', 'TEMPORARILY_UNAVAILABLE', 'INTERNAL_ERROR'];
  return codes.includes(error.code as CronRunDoc['errorCode']) ? (error.code as CronRunDoc['errorCode']) : 'INTERNAL_ERROR';
}

function grpcCode(error: unknown): number | string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number' || typeof code === 'string') return code;
  }
  return undefined;
}

// 更新の途中で消えた（5 NOT_FOUND）・その間に編集された（9 FAILED_PRECONDITION）。refresh_stale では無視する（決まりの一覧 C-8）
function isIgnorableUpdateError(error: unknown): boolean {
  const code = grpcCode(error);
  return code === 5 || code === 'not-found' || code === 9 || code === 'failed-precondition';
}

function isAlreadyExists(error: unknown): boolean {
  const code = grpcCode(error);
  return code === 6 || code === 'already-exists';
}

function log(event: string, fields: Record<string, unknown>): void {
  // 個人情報（uid・メール・サービス名）は出さない。件数とコードだけ
  console.log(JSON.stringify({ cron: event, ...fields }));
}

export async function runDailyCron(options: RunDailyCronOptions): Promise<CronResult> {
  const db = options.db ?? adminDb();
  const now = options.now ?? (() => new Date());
  const limits: CronLimits = { ...CRON_LIMITS, ...options.limits };
  const runDate = options.runDate;
  const startedAt = now();
  const deadlineAt = options.deadlineAt ?? startedAt.getTime() + CRON_DEADLINE_MS;
  const isPastDeadline = () => now().getTime() >= deadlineAt;
  const checkDeadline = () => {
    if (isPastDeadline()) throw new DeadlineReached();
  };

  // ---- 手順3：cronRuns/{runDate} を transaction で確認する ----
  const runRef = db.collection('cronRuns').doc(runDate);
  const base = await db.runTransaction(async (tx: Transaction) => {
    const snapshot = await tx.get(runRef);
    const current = snapshot.exists ? (snapshot.data() as Partial<CronRunDoc>) : null;
    if (current?.status === 'completed') return null; // noop
    if (current?.status === 'running') {
      const started = current.startedAt instanceof Timestamp ? current.startedAt.toMillis() : 0;
      if (startedAt.getTime() - started < CRON_RUNNING_STALE_MS) throw new HttpError(409, 'CRON_ALREADY_RUNNING');
    }
    const start = Timestamp.fromDate(startedAt);
    const counts = {
      createdCount: Number(current?.createdCount ?? 0) || 0,
      sentCount: Number(current?.sentCount ?? 0) || 0,
      failedCount: Number(current?.failedCount ?? 0) || 0,
    };
    const doc: CronRunDoc = {
      runDate,
      status: 'running',
      startedAt: start, // 再開始のたびに今の時刻にする
      finishedAt: null,
      ...counts, // 件数は引き継いで加算する
      errorCode: null,
      expireAt: Timestamp.fromMillis(startedAt.getTime() + RETENTION_MS),
      updatedAt: start,
    };
    tx.set(runRef, doc);
    return counts;
  });
  if (base === null) return { status: 'noop', createdCount: 0, sentCount: 0, failedCount: 0 };

  // この実行の件数（最後に cronRuns の件数へ加算する）
  let createdCount = 0;
  let sentCount = 0;
  const failedSubscriptions = new Set<string>(); // refresh_stale で想定外だったサブスク（1回の実行の中では1回だけ数える）
  let pushFailedCount = 0;
  const failedCount = () => failedSubscriptions.size + pushFailedCount;

  const finish = async (status: CronRunDoc['status'], errorCode: CronRunDoc['errorCode']) => {
    const finishedAt = Timestamp.fromDate(now());
    await runRef.update({
      status,
      finishedAt,
      errorCode,
      createdCount: base.createdCount + createdCount,
      sentCount: base.sentCount + sentCount,
      failedCount: base.failedCount + failedCount(),
      updatedAt: finishedAt,
    });
  };

  let status: RunStatus = 'completed';
  try {
    try {
      // ---- 手順4：refresh_stale ----
      const finished = await refreshStale();
      if (!finished) throw new DeadlineReached(); // 50回で終わらなかった

      // ---- 手順5：candidates ----
      checkDeadline();
      const candidates = await findCandidates();

      // ---- 手順6・7：events ----
      const targets = await createEvents(candidates);

      // ---- 手順8：push ----
      await sendPushes(targets);
    } catch (error) {
      if (!(error instanceof DeadlineReached)) throw error;
      status = 'partial'; // 手順11：残りは次の実行（11時台・18時台）が続ける
    }

    // ---- 手順10：cleanup（partial のとき、始める時点で締切を過ぎているときは行わない。結果は変えない） ----
    if (status === 'completed') await cleanup();

    await finish(status, null);
  } catch (error) {
    // ---- 手順12：例外は failed（エラーの本文は保存しない） ----
    const httpError = fromFirestoreError(error);
    try {
      await finish('failed', errorCodeOf(httpError));
    } catch (saveError) {
      log('save_failed_status_error', { code: fromFirestoreError(saveError).code });
    }
    throw httpError;
  }

  log('finished', { runDate, status, createdCount, sentCount, failedCount: failedCount() });
  return {
    status,
    createdCount: base.createdCount + createdCount,
    sentCount: base.sentCount + sentCount,
    failedCount: base.failedCount + failedCount(),
  };

  // ---- 手順4：nextBillingDate が今日より前のサブスクを、200件ずつ計算し直して更新する ----
  // 終わったら true、50回で終わらなかったら false。締切なら DeadlineReached
  async function refreshStale(): Promise<boolean> {
    for (let round = 0; round < limits.refreshMaxRounds; round += 1) {
      checkDeadline();
      const snapshot = await db.collectionGroup('subscriptions').where('nextBillingDate', '<', runDate).limit(limits.refreshBatchSize).get();
      if (snapshot.empty) return true;
      let progressed = 0; // 更新できた件数（途中で消えた・編集されたものも進んだと数える）
      for (const doc of snapshot.docs) {
        const data = doc.data() as SubscriptionDoc;
        let next: DateString | null = null;
        try {
          next = nextBillingDate(data.firstBillingDate, data.billingCycle, data.billingDayMode, runDate);
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
        }
        if (next === null || next < runDate) {
          // 壊れたデータ・計算し直しても今日より前：更新せず failedCount に数えてログに出す
          if (!failedSubscriptions.has(doc.ref.path)) log('refresh_stale_invalid', { code: 'INVALID_SUBSCRIPTION' });
          failedSubscriptions.add(doc.ref.path);
          continue;
        }
        try {
          // 検索で読んだ文書の updateTime を前提条件に付ける（利用者の編集を、古い請求日から計算した値で上書きしない。C-8）
          await doc.ref.update({ nextBillingDate: next }, { lastUpdateTime: doc.updateTime });
        } catch (error) {
          if (!isIgnorableUpdateError(error)) throw error;
        }
        progressed += 1;
      }
      if (progressed === 0) {
        // 先頭から取得した分がすべて更新できない（想定外のデータだけが残った）。更新をやめて次の段階へ進む
        log('refresh_stale_stopped', { code: 'NO_PROGRESS', count: snapshot.size });
        return true;
      }
      if (snapshot.size < limits.refreshBatchSize) return true;
    }
    return false;
  }

  // ---- 手順5：nextBillingDate・trialEndDate が今日+1日か今日+7日のサブスク（collectionGroup。in の2値） ----
  async function findCandidates(): Promise<Candidate[]> {
    const dates = [addDays(runDate, 1), addDays(runDate, 7)];
    const [byBilling, byTrial] = await Promise.all([
      db.collectionGroup('subscriptions').where('nextBillingDate', 'in', dates).get(),
      db.collectionGroup('subscriptions').where('trialEndDate', 'in', dates).get(),
    ]);
    const found = new Map<string, Candidate>();
    for (const doc of [...byBilling.docs, ...byTrial.docs]) {
      const uid = uidOf(doc.ref);
      if (!uid || found.has(doc.ref.path)) continue;
      found.set(doc.ref.path, { uid, subscription: { ...(doc.data() as SubscriptionDoc), subscriptionId: doc.id } });
    }
    return [...found.values()];
  }

  // ---- 手順6・7：候補ごとに判定し、決定的IDで作る（users/{uid} とその通知イベントを読む transaction の中で） ----
  // 戻り値は、判定を通った通知イベントのうち、targetDate が今日で webPushStatus が pending のもの（手順 8-1）
  async function createEvents(candidates: Candidate[]): Promise<PushTarget[]> {
    const byUid = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const list = byUid.get(candidate.uid) ?? [];
      list.push(candidate);
      byUid.set(candidate.uid, list);
    }
    const targets: PushTarget[] = [];
    for (const [uid, list] of byUid) {
      checkDeadline();
      // 同じ uid の users は、この判定では1回だけ読む。無ければその uid は何も作らない
      const userSnapshot = await db.collection('users').doc(uid).get();
      if (!userSnapshot.exists) continue;
      if (userSnapshot.data()?.accountNotificationEnabled === false) continue; // 項目が無いドキュメントは true
      for (const { subscription } of list) {
        for (const plan of planNotifications(subscription, runDate)) {
          checkDeadline(); // イベント作成の1件ごと
          const id = notificationId(uid, subscription.subscriptionId, plan.notificationType, plan.daysBefore, plan.targetDate);
          await options.hooks?.beforeCreateEvent?.(uid, id);
          const event = await createEvent(uid, subscription.subscriptionId, id, plan);
          if (event && event.targetDate === runDate && event.webPushStatus === 'pending') targets.push({ uid, event });
        }
      }
    }
    return targets;
  }

  // 1件の通知イベントを作る。users/{uid} が無くなっていたら作らず null。すでにあれば何もせず、その内容を返す
  async function createEvent(
    uid: string,
    subscriptionId: string,
    id: string,
    plan: ReturnType<typeof planNotifications>[number],
  ): Promise<NotificationEvent | null> {
    const userRef = db.collection('users').doc(uid);
    const eventRef = userRef.collection('notificationEvents').doc(id);
    try {
      return await db.runTransaction(async (tx: Transaction) => {
        const userSnapshot = await tx.get(userRef);
        if (!userSnapshot.exists) return { created: false, event: null };
        const eventSnapshot: DocumentSnapshot = await tx.get(eventRef);
        if (eventSnapshot.exists) return { created: false, event: toNotificationEvent(eventSnapshot.data() ?? {}) };
        // createdAt はミリ秒精度（serverTimestamp は使わない）。expireAt は createdAt+90日。updatedAt は createdAt と同じ値
        const createdAt = Timestamp.fromDate(now());
        const doc: NotificationEventDoc = {
          notificationId: id,
          uid,
          subscriptionId,
          serviceNameAtNotification: plan.serviceNameAtNotification,
          notificationType: plan.notificationType,
          daysBefore: plan.daysBefore,
          targetDate: plan.targetDate,
          title: plan.title,
          body: plan.body,
          priceAtNotification: plan.priceAtNotification,
          webPushStatus: 'pending',
          webPushDeliveredIds: [],
          viewedAt: null,
          webPushSentAt: null,
          webPushLastErrorCode: null,
          expireAt: Timestamp.fromMillis(createdAt.toMillis() + RETENTION_MS),
          createdAt,
          updatedAt: createdAt,
        };
        tx.create(eventRef, doc);
        return { created: true, event: toNotificationEvent(doc) };
      }).then((result) => {
        if (result.created) createdCount += 1;
        return result.event;
      });
    } catch (error) {
      // 同じIDがすでにある（ALREADY_EXISTS）ときは何もしない。ほかのエラー（ABORTED など）は失敗（手順12）
      if (!isAlreadyExists(error)) throw error;
      const snapshot = await eventRef.get();
      return snapshot.exists ? toNotificationEvent(snapshot.data() ?? {}) : null;
    }
  }

  // ---- 手順8：利用者ごとに、通知イベントを1件ずつ順に PushSender へ渡す ----
  async function sendPushes(targets: PushTarget[]): Promise<void> {
    const byUid = new Map<string, NotificationEvent[]>();
    for (const { uid, event } of targets) {
      const list = byUid.get(uid) ?? [];
      list.push(event);
      byUid.set(uid, list);
    }
    for (const [uid, events] of byUid) {
      checkDeadline(); // 利用者ごとの処理の前
      for (const event of events) {
        checkDeadline(); // 通知イベント1件の送信の前
        const result: PushResult = await options.pushSender(uid, event); // 例外はそのまま投げる（その実行を failed にする）
        if (result.status === 'sent' || result.status === 'partially_sent') sentCount += 1;
        else if (result.status === 'failed') pushFailedCount += 1;
        // skipped はどちらにも数えない
      }
    }
  }

  // ---- 手順10：expireAt が現在以前の通知イベント（collectionGroup）と cronRuns を、500件ずつ（最大10回）削除する ----
  async function cleanup(): Promise<void> {
    const cutoff = Timestamp.fromDate(now());
    const deleteExpired = (query: FirebaseFirestore.Query) => async (limit: number) => {
      const snapshot = await query.where('expireAt', '<=', cutoff).limit(limit).get();
      if (snapshot.empty) return 0;
      const batch = db.batch();
      snapshot.docs.forEach((doc: QueryDocumentSnapshot) => batch.delete(doc.ref));
      await batch.commit();
      return snapshot.size;
    };
    const loopOptions = { batchSize: limits.cleanupBatchSize, maxRounds: limits.cleanupMaxRounds };
    const events = await runCleanupLoop(deleteExpired(db.collectionGroup('notificationEvents')), isPastDeadline, loopOptions);
    const runs = await runCleanupLoop(deleteExpired(db.collection('cronRuns')), isPastDeadline, loopOptions);
    for (const [kind, result] of [['notificationEvents', events], ['cronRuns', runs]] as const) {
      if (result.error !== null) {
        // 削除に失敗しても結果は変えず、削除した件数とともにログにだけ出す
        log('cleanup_failed', { kind, deleted: result.deleted, code: fromFirestoreError(result.error).code });
      } else if (result.deleted > 0 || result.stoppedByDeadline) {
        log('cleanup', { kind, deleted: result.deleted, stoppedByDeadline: result.stoppedByDeadline });
      }
    }
  }
}
