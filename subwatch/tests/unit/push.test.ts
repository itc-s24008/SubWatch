// lib/push.ts の送信（04-15。PushSender。詳細_F-06 の手順8〜9、API共通仕様 B26・B90・B96、DB設計書 テーブルNo.3）
// テスト一覧の No.32・43（送信済みの端末へ再送しない部分）・47 と、番号なしの再試行・時間切れ・状態の集約・中身
// 送信関数（send）・保存先（store）・待ち（sleep）・時刻（now）は差し替える（本物の Push サービスに送らない）
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_SEND,
  VapidNotConfiguredError,
  classifySendError,
  createPushSender,
  pushPayloadOf,
  pushSender,
  webPushSend,
  type PushStore,
  type PushTarget,
  type WebPushSend,
} from '@/lib/push';
import type { NotificationEvent } from '@/lib/types';

const UID = 'user-1';
const NOW = new Date('2026-11-24T00:01:00.000Z');

function target(id: string): PushTarget {
  return { webPushId: id, endpoint: `https://push.example.com/${id}`, p256dh: `p256dh-${id}`, auth: `auth-${id}` };
}

function event(fields: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    notificationId: 'n'.repeat(64),
    uid: UID,
    subscriptionId: 'a'.repeat(20),
    serviceNameAtNotification: 'Spotify',
    notificationType: 'billing',
    daysBefore: 1,
    targetDate: '2026-11-04',
    title: '請求日まであと1日',
    body: '11/05・¥980 の請求予定',
    priceAtNotification: 980,
    webPushStatus: 'pending',
    webPushDeliveredIds: [],
    ...fields,
  };
}

// 保存先の偽物（呼ばれた順を記録する）
function fakeStore(targets: PushTarget[]) {
  const calls: { kind: string; args: unknown[] }[] = [];
  const store: PushStore = {
    listTargets: vi.fn(async () => targets),
    addDelivered: vi.fn(async (...args: unknown[]) => {
      calls.push({ kind: 'addDelivered', args });
    }),
    deleteSubscription: vi.fn(async (...args: unknown[]) => {
      calls.push({ kind: 'deleteSubscription', args });
    }),
    saveResult: vi.fn(async (...args: unknown[]) => {
      calls.push({ kind: 'saveResult', args });
    }),
  };
  return { store, calls };
}

function httpError(statusCode: number) {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
}

// 端末ごとに、呼ばれた回数に応じた結果を返す送信関数（'ok' か statusCode か 'network' か 'hang'）
function scriptedSend(script: Record<string, (number | 'ok' | 'network' | 'hang')[]>) {
  const counts: Record<string, number> = {};
  const send = vi.fn<WebPushSend>(async (t) => {
    counts[t.webPushId] = (counts[t.webPushId] ?? 0) + 1;
    const steps = script[t.webPushId] ?? ['ok'];
    const step = steps[Math.min(counts[t.webPushId] - 1, steps.length - 1)];
    if (step === 'ok') return;
    if (step === 'network') throw new Error('ECONNRESET');
    if (step === 'hang') return new Promise<void>(() => undefined);
    throw httpError(step);
  });
  return { send, counts };
}

const noSleep = vi.fn(async () => undefined);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  noSleep.mockClear();
});

describe('PushSender（createPushSender）', () => {
  it('全端末に成功すると sent。成功した端末はすぐ webPushDeliveredIds に足し、最後に結果を保存する', async () => {
    const { store, calls } = fakeStore([target('A'), target('B')]);
    const { send } = scriptedSend({});
    const sender = createPushSender({ send, store, sleep: noSleep, now: () => NOW });
    const result = await sender(UID, event());
    expect(result).toEqual({ status: 'sent', deliveredIds: expect.arrayContaining(['A', 'B']), lastErrorCode: null });
    expect(result.deliveredIds).toHaveLength(2);
    expect(calls.filter((c) => c.kind === 'addDelivered')).toHaveLength(2);
    expect(calls[calls.length - 1]).toEqual({
      kind: 'saveResult',
      args: [UID, 'n'.repeat(64), { status: 'sent', deliveredIds: result.deliveredIds, sentAt: NOW, lastErrorCode: null }],
    });
  });

  it('No.32 送信先が 404・410 なら、その購読を削除する', async () => {
    const { store } = fakeStore([target('A'), target('B'), target('C')]);
    const { send } = scriptedSend({ A: [404], B: [410] });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(store.deleteSubscription).toHaveBeenCalledWith(UID, 'A');
    expect(store.deleteSubscription).toHaveBeenCalledWith(UID, 'B');
    expect(store.deleteSubscription).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('partially_sent');
    expect(result.deliveredIds).toEqual(['C']);
  });

  it('No.32 再試行の結果が 410 のときも削除する（1回目 503 → 1秒後に 410）', async () => {
    const { store } = fakeStore([target('A')]);
    const { send, counts } = scriptedSend({ A: [503, 410] });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(counts.A).toBe(2);
    expect(noSleep).toHaveBeenCalledWith(PUSH_SEND.retryDelayMs);
    expect(store.deleteSubscription).toHaveBeenCalledWith(UID, 'A');
    expect(result).toEqual({ status: 'failed', deliveredIds: [], lastErrorCode: '410' });
  });

  it('No.47 複数端末で一部が失敗すると partially_sent。404/410 の端末は削除、401/403 は残す（ログは code と HTTP ステータスだけ）', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store } = fakeStore([target('ok'), target('gone'), target('auth')]);
    const { send } = scriptedSend({ gone: [410], auth: [403] });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(result.status).toBe('partially_sent');
    expect(result.deliveredIds).toEqual(['ok']);
    expect(store.deleteSubscription).toHaveBeenCalledTimes(1);
    expect(store.deleteSubscription).toHaveBeenCalledWith(UID, 'gone');
    expect(errorLog).toHaveBeenCalledWith(JSON.stringify({ code: 'PUSH_CONFIG_ERROR', status: 403 }));
    const logged = errorLog.mock.calls.flat().join(' ');
    expect(logged).not.toContain('push.example.com');
    expect(logged).not.toContain('auth-auth');
  });

  it('No.43 送信済みの端末（渡された webPushDeliveredIds にある ID）へは再送しない。前の分も成功に数えて sent', async () => {
    const { store } = fakeStore([target('A'), target('B')]);
    const { send, counts } = scriptedSend({});
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event({ webPushDeliveredIds: ['A'] }));
    expect(counts.A).toBeUndefined();
    expect(counts.B).toBe(1);
    expect(result).toEqual({ status: 'sent', deliveredIds: ['A', 'B'], lastErrorCode: null });
  });

  it('No.43 全端末が送信済みなら、1件も送らずに sent', async () => {
    const { store } = fakeStore([target('A')]);
    const { send } = scriptedSend({});
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event({ webPushDeliveredIds: ['A'] }));
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'sent', deliveredIds: ['A'], lastErrorCode: null });
  });

  it('No.43 前の実行で送った端末が今は無くても、webPushDeliveredIds に ID があれば sent（購読が0件でも）', async () => {
    const { store } = fakeStore([]);
    const { send } = scriptedSend({});
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event({ webPushDeliveredIds: ['old'] }));
    expect(result.status).toBe('sent');
  });

  it('購読も送信済みも0件なら skipped。webPushStatus は保存し、webPushSentAt は null', async () => {
    const { store } = fakeStore([]);
    const { send } = scriptedSend({});
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(result).toEqual({ status: 'skipped', deliveredIds: [], lastErrorCode: null });
    expect(store.saveResult).toHaveBeenCalledWith(UID, 'n'.repeat(64), { status: 'skipped', deliveredIds: [], sentAt: null, lastErrorCode: null });
  });

  it('成功が0件なら failed（webPushSentAt は入れる）', async () => {
    const { store } = fakeStore([target('A')]);
    const { send } = scriptedSend({ A: [400] });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(result).toEqual({ status: 'failed', deliveredIds: [], lastErrorCode: '400' });
    expect(store.saveResult).toHaveBeenCalledWith(UID, 'n'.repeat(64), { status: 'failed', deliveredIds: [], sentAt: NOW, lastErrorCode: '400' });
    expect(store.deleteSubscription).not.toHaveBeenCalled(); // そのほかの4xx は購読を残す
  });

  it.each([
    ['500', [500, 'ok']],
    ['503', [503, 'ok']],
    ['429', [429, 'ok']],
    ['通信エラー（statusCode なし）', ['network', 'ok']],
  ] as const)('%s は1秒後に1回だけ再試行し、成功した端末のコードは残さない', async (_name, steps) => {
    const { store } = fakeStore([target('A')]);
    const { send, counts } = scriptedSend({ A: [...steps] });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(counts.A).toBe(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'sent', deliveredIds: ['A'], lastErrorCode: null });
  });

  it('再試行は1回だけ（2回とも 503 なら failed、コードは 503）', async () => {
    const { store } = fakeStore([target('A')]);
    const { send, counts } = scriptedSend({ A: [503, 503, 'ok'] });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(counts.A).toBe(2);
    expect(result).toEqual({ status: 'failed', deliveredIds: [], lastErrorCode: '503' });
  });

  it.each([400, 401, 403, 404, 410, 413])('%i は再試行しない', async (statusCode) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store } = fakeStore([target('A')]);
    const { send, counts } = scriptedSend({ A: [statusCode, 'ok'] });
    await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(counts.A).toBe(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('1端末あたり、送信を始めてから10秒で打ち切り（timeout）、1秒後に1回だけ再試行する', async () => {
    vi.useFakeTimers();
    const { store } = fakeStore([target('A')]);
    const { send, counts } = scriptedSend({ A: ['hang', 'hang'] });
    const running = createPushSender({ send, store, now: () => NOW })(UID, event());
    await vi.advanceTimersByTimeAsync(PUSH_SEND.timeoutMs - 1);
    expect(counts.A).toBe(1);
    await vi.advanceTimersByTimeAsync(1 + PUSH_SEND.retryDelayMs);
    expect(counts.A).toBe(2);
    await vi.advanceTimersByTimeAsync(PUSH_SEND.timeoutMs);
    expect(await running).toEqual({ status: 'failed', deliveredIds: [], lastErrorCode: 'timeout' });
  });

  it('VAPID 鍵の未設定は再試行せず、コードは vapid_not_configured（例外を投げない）', async () => {
    const { store } = fakeStore([target('A')]);
    const send = vi.fn<WebPushSend>(async () => {
      throw new VapidNotConfiguredError();
    });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'failed', deliveredIds: [], lastErrorCode: 'vapid_not_configured' });
  });

  it('webPushLastErrorCode は、失敗が分かった順で最後のもの', async () => {
    vi.useFakeTimers();
    const { store } = fakeStore([target('slow'), target('fast')]);
    const send = vi.fn<WebPushSend>(async (t) => {
      if (t.webPushId === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        throw httpError(400);
      }
      throw httpError(413);
    });
    const running = createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    await vi.advanceTimersByTimeAsync(1000);
    expect((await running).lastErrorCode).toBe('400');
  });

  it('同時に送るのは最大10端末', async () => {
    const targets = Array.from({ length: 11 }, (_, i) => target(`d${i}`));
    const { store } = fakeStore(targets);
    let running = 0;
    let peak = 0;
    const send = vi.fn<WebPushSend>(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    });
    const result = await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(peak).toBe(PUSH_SEND.concurrency);
    expect(result.status).toBe('sent');
    expect(result.deliveredIds).toHaveLength(11);
  });

  it('Push の中身は {title:「サービス名：title」, body, url:「/subscriptions/{subscriptionId}」, notificationId}', async () => {
    const { store } = fakeStore([target('A')]);
    const { send } = scriptedSend({});
    await createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event());
    expect(JSON.parse(send.mock.calls[0][1])).toEqual({
      title: 'Spotify：請求日まであと1日',
      body: '11/05・¥980 の請求予定',
      url: `/subscriptions/${'a'.repeat(20)}`,
      notificationId: 'n'.repeat(64),
    });
    expect(pushPayloadOf(event({ serviceNameAtNotification: 'ChatGPT', title: '無料トライアル終了まであと7日', body: '最終無料日は11/10です', notificationType: 'trial_end' }))).toMatchObject({
      title: 'ChatGPT：無料トライアル終了まであと7日',
      body: '最終無料日は11/10です',
    });
  });

  it('Firestore の保存の失敗は例外のまま（Cron が実行を failed にする）', async () => {
    const { store } = fakeStore([target('A')]);
    (store.saveResult as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('unavailable'), { code: 14 }));
    const { send } = scriptedSend({});
    await expect(createPushSender({ send, store, sleep: noSleep, now: () => NOW })(UID, event())).rejects.toMatchObject({ code: 14 });
  });

  it('pushSender は PushSender の形の関数', () => {
    expect(typeof pushSender).toBe('function');
    expect(pushSender.length).toBe(2);
  });
});

describe('classifySendError・webPushSend', () => {
  it('HTTP の番号の文字列、通信エラーは network_error、VAPID 鍵の未設定は vapid_not_configured', () => {
    expect(classifySendError(httpError(410))).toMatchObject({ code: '410', statusCode: 410, retryable: false });
    expect(classifySendError(httpError(502))).toMatchObject({ code: '502', retryable: true });
    expect(classifySendError(new Error('socket hang up'))).toMatchObject({ code: 'network_error', statusCode: null, retryable: true });
    expect(classifySendError(new VapidNotConfiguredError())).toMatchObject({ code: 'vapid_not_configured', retryable: false });
  });

  it('既定の送信関数は、VAPID の鍵が無ければ送らずに VapidNotConfiguredError', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    await expect(webPushSend(target('A'), '{}')).rejects.toBeInstanceOf(VapidNotConfiguredError);
    vi.unstubAllEnvs();
  });
});
