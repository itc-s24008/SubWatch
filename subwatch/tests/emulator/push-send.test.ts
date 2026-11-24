// lib/push.ts の送信の、Firestore への保存（04-15。PushSender と firestorePushStore。送信関数だけを差し替える）
// テスト一覧の No.32・43・47 の保存の部分と、番号なしの「対象の項目と updatedAt だけを update」「通知イベントが無いときは無視」「skipped も保存」
// API共通仕様 B90・B106、DB設計書 テーブルNo.3・3.補足設計 B16
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminDb } from '@/lib/firebase-admin';
import { createPushSender, type WebPushSend } from '@/lib/push';
import type { NotificationEvent, NotificationEventDoc } from '@/lib/types';
import { resetEmulators, seedNotificationEvents, seedPushSubscription, seedUser } from './helpers';

const NOW = new Date('2026-11-24T00:01:00.000Z');
const CREATED = Timestamp.fromDate(new Date('2026-11-24T00:00:30.000Z'));

// 通知イベントを Firestore に直接置き、PushSender に渡す形（NotificationEvent）で返す。
// 置き方は 04-14 の seedNotificationEvents（tests/emulator/helpers.ts）。11/25 のα版の統合で、このファイルの中の仮の道具からそろえた。
// このファイルの値（サービス名・請求日・作成日時）は、前の仮の道具と同じものを渡す（notificationId は決定的ID になる）
async function seedEvent(uid: string, fields: Partial<NotificationEventDoc> = {}): Promise<NotificationEvent> {
  const [doc] = await seedNotificationEvents(uid, [
    {
      serviceNameAtNotification: 'Spotify',
      targetDate: '2026-11-24',
      body: '11/25・¥980 の請求予定',
      createdAt: CREATED,
      ...fields,
    },
  ]);
  const { viewedAt: _v, webPushSentAt: _s, webPushLastErrorCode: _l, expireAt: _e, createdAt: _c, updatedAt: _u, ...event } = doc;
  return event;
}

function eventRef(uid: string, id: string) {
  return adminDb().collection('users').doc(uid).collection('notificationEvents').doc(id);
}

function subscriptionIds(uid: string) {
  return adminDb()
    .collection('users')
    .doc(uid)
    .collection('webPushSubscriptions')
    .get()
    .then((s) => s.docs.map((d) => d.id).sort());
}

// endpoint の最後の部分で結果を決める送信関数（'ok'・'410'・'403'・'500'）
function sendBy(results: Record<string, 'ok' | number>): WebPushSend {
  return vi.fn(async (target) => {
    const key = target.endpoint.split('/').pop()!;
    const result = results[key] ?? 'ok';
    if (result !== 'ok') throw Object.assign(new Error(`HTTP ${result}`), { statusCode: result });
  });
}

const sleep = async () => undefined;

beforeEach(async () => {
  await resetEmulators();
});

describe('PushSender の保存（Firestore）', () => {
  it('No.47 一部が失敗すると partially_sent。404/410 の購読は削除、401/403 は残す。結果の4項目と updatedAt を保存する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const uid = 'push-user-47';
    await seedUser(uid);
    const ok = await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/ok' });
    const gone = await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/gone' });
    const denied = await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/denied' });
    const event = await seedEvent(uid);
    const sender = createPushSender({ send: sendBy({ gone: 410, denied: 403 }), sleep, now: () => NOW });

    const result = await sender(uid, event);

    expect(result).toEqual({ status: 'partially_sent', deliveredIds: [ok.webPushId], lastErrorCode: expect.stringMatching(/^(410|403)$/) });
    expect(await subscriptionIds(uid)).toEqual([ok.webPushId, denied.webPushId].sort());
    expect(await subscriptionIds(uid)).not.toContain(gone.webPushId);
    const saved = (await eventRef(uid, event.notificationId).get()).data()!;
    expect(saved.webPushStatus).toBe('partially_sent');
    expect(saved.webPushDeliveredIds).toEqual([ok.webPushId]);
    expect((saved.webPushSentAt as Timestamp).toDate()).toEqual(NOW);
    expect(saved.webPushLastErrorCode).toBe(result.lastErrorCode);
    expect((saved.updatedAt as Timestamp).toDate()).toEqual(NOW);
  });

  it('No.32 送信先が 404 なら、その購読のドキュメントが削除される', async () => {
    const uid = 'push-user-32';
    await seedUser(uid);
    const gone = await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/gone' });
    const event = await seedEvent(uid);
    const result = await createPushSender({ send: sendBy({ gone: 404 }), sleep, now: () => NOW })(uid, event);
    expect(result).toEqual({ status: 'failed', deliveredIds: [], lastErrorCode: '404' });
    expect(await subscriptionIds(uid)).toEqual([]);
    expect(gone.webPushId).toMatch(/^[0-9a-f]{64}$/);
    expect((await eventRef(uid, event.notificationId).get()).get('webPushStatus')).toBe('failed');
  });

  it('No.43 途中で止まった後の再実行：webPushDeliveredIds にある端末へは再送せず、続きの端末だけに送って sent', async () => {
    const uid = 'push-user-43';
    await seedUser(uid);
    const first = await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/first' });
    const second = await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/second' });
    // 前の実行で first へ送り終え、保存の前に止まった（pending のまま、webPushDeliveredIds に first だけがある）
    const event = await seedEvent(uid, { webPushDeliveredIds: [first.webPushId] });
    const send = sendBy({});
    const result = await createPushSender({ send, sleep, now: () => NOW })(uid, event);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(send).mock.calls[0][0].webPushId).toBe(second.webPushId);
    expect(result.status).toBe('sent');
    const saved = (await eventRef(uid, event.notificationId).get()).data()!;
    expect([...saved.webPushDeliveredIds].sort()).toEqual([first.webPushId, second.webPushId].sort());
    expect(saved.webPushStatus).toBe('sent');
  });

  it('成功した端末は、最後の保存を待たずに、すぐ webPushDeliveredIds に足して保存する', async () => {
    const uid = 'push-user-immediate';
    await seedUser(uid);
    const a = await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/a' });
    await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/b' });
    const event = await seedEvent(uid);
    let seenWhileSendingB = false;
    const send: WebPushSend = async (target) => {
      if (target.endpoint.endsWith('/a')) return;
      // b の送信の間に、a がもう保存されているか（最後の保存より前）を見る
      for (let i = 0; i < 100 && !seenWhileSendingB; i += 1) {
        const ids = ((await eventRef(uid, event.notificationId).get()).get('webPushDeliveredIds') ?? []) as string[];
        seenWhileSendingB = ids.includes(a.webPushId);
        if (!seenWhileSendingB) await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    await createPushSender({ send, sleep, now: () => NOW, timeoutMs: 5_000 })(uid, event);
    expect(seenWhileSendingB).toBe(true);
  });

  it('購読も送信済みも無ければ skipped を保存する（webPushSentAt と webPushLastErrorCode は null）', async () => {
    const uid = 'push-user-skipped';
    await seedUser(uid);
    const event = await seedEvent(uid);
    const result = await createPushSender({ send: sendBy({}), sleep, now: () => NOW })(uid, event);
    expect(result).toEqual({ status: 'skipped', deliveredIds: [], lastErrorCode: null });
    const saved = (await eventRef(uid, event.notificationId).get()).data()!;
    expect(saved.webPushStatus).toBe('skipped');
    expect(saved.webPushSentAt).toBeNull();
    expect(saved.webPushLastErrorCode).toBeNull();
  });

  it('保存は対象の項目と updatedAt だけ（送信の間に付いた既読〔viewedAt〕や、ほかの項目を消さない）', async () => {
    const uid = 'push-user-partial-update';
    await seedUser(uid);
    await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/a' });
    const event = await seedEvent(uid);
    const viewedAt = Timestamp.fromDate(new Date('2026-11-24T00:00:50.000Z'));
    const send: WebPushSend = async () => {
      await eventRef(uid, event.notificationId).update({ viewedAt }); // 送信の間に既読になった
    };
    await createPushSender({ send, sleep, now: () => NOW })(uid, event);
    const saved = (await eventRef(uid, event.notificationId).get()).data()!;
    expect((saved.viewedAt as Timestamp).toMillis()).toBe(viewedAt.toMillis());
    expect(saved.title).toBe('請求日まであと1日');
    expect((saved.createdAt as Timestamp).toMillis()).toBe(CREATED.toMillis());
    expect(saved.webPushStatus).toBe('sent');
  });

  it('送信の間にアカウントが削除され、通知イベントが無い（NOT_FOUND）ときは、作り直さずに無視する（例外を投げない）', async () => {
    const uid = 'push-user-deleted';
    await seedUser(uid);
    await seedPushSubscription(uid, { endpoint: 'https://push.example.com/send/a' });
    const event = await seedEvent(uid);
    const send: WebPushSend = async () => {
      await adminDb().recursiveDelete(adminDb().collection('users').doc(uid)); // 送信の間に削除された
    };
    const result = await createPushSender({ send, sleep, now: () => NOW })(uid, event);
    expect(result.status).toBe('sent');
    expect((await eventRef(uid, event.notificationId).get()).exists).toBe(false);
  });
});
