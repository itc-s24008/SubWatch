// lib/push-client.ts（04-12。ブラウザの Push の判定と操作。ブラウザの部品はテストの中の偽物に差し替える）
// テスト一覧の No.63（あわせての分：ログアウトでは結果に関係なくブラウザの購読を解除し、onApiGate を呼ばない〔skipGate〕。
// ブラウザに購読が無い端末ではログアウトで DELETE を呼ばない）・No.64（⑤の判定）と、番号なしの unsubscribeBrowserPush・登録の本文・登録の流れ
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ api: apiMock }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => undefined) }));
vi.mock('@/lib/firebase-client', () => ({ getFirebaseAuth: () => ({}) }));

import { logout, runLocalCleanup } from '@/lib/logout';
import {
  LOGOUT_DELETE_WAIT_MS,
  SW_READY_TIMEOUT_MS,
  checkThisDevice,
  detectPushSupport,
  disablePush,
  enablePush,
  logoutPushCleanup,
  serverCheckOf,
  subscribeRequestBody,
  unsubscribeBrowserPush,
  webPushIdOf,
} from '@/lib/push-client';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/fake-endpoint';

interface FakeSubscription {
  endpoint: string;
  unsubscribe: ReturnType<typeof vi.fn>;
  toJSON: () => PushSubscriptionJSON;
}

function fakeSubscription(endpoint = ENDPOINT, unsubscribeFails = false): FakeSubscription {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => {
      if (unsubscribeFails) throw new Error('unsubscribe failed');
      return true;
    }),
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
  };
}

interface FakeBrowser {
  subscription: FakeSubscription | null;
  subscribe: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  readyNever: boolean;
}

// ブラウザ（navigator・window・Notification）を差し替える。subscription は「ブラウザにある購読」
function installBrowser(options: { subscription?: FakeSubscription | null; permission?: NotificationPermission; serviceWorker?: boolean; userAgent?: string } = {}): FakeBrowser {
  const state: FakeBrowser = {
    subscription: options.subscription ?? null,
    subscribe: vi.fn(),
    register: vi.fn(async () => ({})),
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
    readyNever: false,
  };
  const pushManager = {
    getSubscription: vi.fn(async () => state.subscription),
    subscribe: state.subscribe,
  };
  const registration = { pushManager };
  state.subscribe.mockImplementation(async () => {
    state.subscription = fakeSubscription('https://fcm.googleapis.com/fcm/send/new-endpoint');
    return state.subscription;
  });
  const serviceWorker = {
    getRegistration: vi.fn(async () => registration),
    register: state.register,
    get ready() {
      return state.readyNever ? new Promise(() => undefined) : Promise.resolve(registration);
    },
  };
  const Notification = { permission: options.permission ?? 'default', requestPermission: state.requestPermission };
  const navigatorValue: Record<string, unknown> = { userAgent: options.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', platform: 'Linux x86_64', maxTouchPoints: 0 };
  if (options.serviceWorker !== false) navigatorValue.serviceWorker = serviceWorker;
  vi.stubGlobal('navigator', navigatorValue);
  vi.stubGlobal('window', { PushManager: function PushManager() {}, Notification, matchMedia: () => ({ matches: false }) });
  return state;
}

beforeEach(() => {
  apiMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('webPushIdOf・serverCheckOf（⑤の判定。No.64）', () => {
  it('webPushId は endpoint の sha256 の小文字16進64文字（サーバーと同じ値）', async () => {
    const expected = createHash('sha256').update(ENDPOINT, 'utf8').digest('hex');
    expect(await webPushIdOf(ENDPOINT)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('No.64 pushSubscriptionIds にこの端末の ID があれば registered、無ければ missing、配列が無ければ unknown', () => {
    expect(serverCheckOf('b', { pushSubscriptionIds: ['a', 'b'] })).toBe('registered');
    expect(serverCheckOf('c', { pushSubscriptionIds: ['a', 'b'] })).toBe('missing');
    expect(serverCheckOf('c', { pushSubscriptionIds: [] })).toBe('missing');
    expect(serverCheckOf('c', {})).toBe('unknown');
    expect(serverCheckOf('c', null)).toBe('unknown');
  });
});

describe('checkThisDevice（⑤の確認。No.64）', () => {
  it('No.64 ブラウザに購読があり、pushSubscriptionIds にこの端末の ID が無いと、ブラウザの購読を解除して false', async () => {
    const browser = installBrowser({ subscription: fakeSubscription(), permission: 'granted' });
    apiMock.mockResolvedValue({ pushSubscriptionIds: ['0'.repeat(64)] });
    expect(await checkThisDevice()).toBe(false);
    expect(apiMock).toHaveBeenCalledWith('/api/account');
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('No.64 ID があれば true のまま（解除しない）', async () => {
    const browser = installBrowser({ subscription: fakeSubscription(), permission: 'granted' });
    apiMock.mockResolvedValue({ pushSubscriptionIds: [await webPushIdOf(ENDPOINT)] });
    expect(await checkThisDevice()).toBe(true);
    expect(browser.subscription!.unsubscribe).not.toHaveBeenCalled();
  });

  it('GET /api/account を読めなかったとき・pushSubscriptionIds が無いときは、ブラウザの判定のまま true', async () => {
    const browser = installBrowser({ subscription: fakeSubscription(), permission: 'granted' });
    apiMock.mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503, code: 'TEMPORARILY_UNAVAILABLE' }));
    expect(await checkThisDevice()).toBe(true);
    apiMock.mockResolvedValueOnce({ email: 'a@example.com' });
    expect(await checkThisDevice()).toBe(true);
    expect(browser.subscription!.unsubscribe).not.toHaveBeenCalled();
  });

  it('ブラウザに購読が無ければ false で、GET /api/account を読まない', async () => {
    installBrowser({ subscription: null });
    expect(await checkThisDevice()).toBe(false);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('ブラウザの購読の解除に失敗しても false（「オフ」と表示する）', async () => {
    installBrowser({ subscription: fakeSubscription(ENDPOINT, true), permission: 'granted' });
    apiMock.mockResolvedValue({ pushSubscriptionIds: [] });
    expect(await checkThisDevice()).toBe(false);
  });
});

describe('unsubscribeBrowserPush（サーバーを呼ばない解除）', () => {
  it('ブラウザの購読を解除し、サーバーの API は呼ばない', async () => {
    const browser = installBrowser({ subscription: fakeSubscription() });
    await unsubscribeBrowserPush();
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('解除に失敗しても、Service Worker が無くても、例外を投げない', async () => {
    installBrowser({ subscription: fakeSubscription(ENDPOINT, true) });
    await expect(unsubscribeBrowserPush()).resolves.toBeUndefined();
    installBrowser({ serviceWorker: false });
    await expect(unsubscribeBrowserPush()).resolves.toBeUndefined();
  });

  it('registerLocalCleanup に登録してあり、runLocalCleanup() で呼ばれる（401 のサインアウトの前・アカウント削除の後）', async () => {
    const browser = installBrowser({ subscription: fakeSubscription() });
    await runLocalCleanup();
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('ログアウト（logoutPushCleanup。registerBeforeLogout に登録）', () => {
  it('No.63 サーバーの DELETE /api/push/subscribe が失敗しても、ブラウザの購読を解除する（skipGate で呼ぶ）', async () => {
    const browser = installBrowser({ subscription: fakeSubscription() });
    apiMock.mockRejectedValue(Object.assign(new Error('500'), { status: 500, code: 'INTERNAL_ERROR' }));
    await logout();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/api/push/subscribe', { method: 'DELETE', body: { endpoint: ENDPOINT }, skipGate: true });
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('No.63 409 ACCOUNT_NOT_INITIALIZED が返っても、ブラウザの購読を解除する', async () => {
    const browser = installBrowser({ subscription: fakeSubscription() });
    apiMock.mockRejectedValue(Object.assign(new Error('409'), { status: 409, code: 'ACCOUNT_NOT_INITIALIZED' }));
    await logoutPushCleanup();
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('No.63 ブラウザに購読が無い端末では、ログアウトで DELETE /api/push/subscribe を呼ばない', async () => {
    installBrowser({ subscription: null });
    await logout();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('DELETE の応答を待つのは2.5秒まで。その後ブラウザの購読を解除する', async () => {
    vi.useFakeTimers();
    const browser = installBrowser({ subscription: fakeSubscription() });
    apiMock.mockReturnValue(new Promise(() => undefined)); // 応答が無い
    let done = false;
    const running = logoutPushCleanup().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(LOGOUT_DELETE_WAIT_MS - 1);
    expect(browser.subscription!.unsubscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(done).toBe(true);
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('成功したときも、ブラウザの購読を解除する', async () => {
    const browser = installBrowser({ subscription: fakeSubscription() });
    apiMock.mockResolvedValue(undefined);
    await logoutPushCleanup();
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('登録で送る本文', () => {
  it('endpoint・keys.p256dh・keys.auth だけを選び（expirationTime は送らない）、userAgent は512文字までに切る', () => {
    const subscription = fakeSubscription() as unknown as PushSubscription;
    expect(subscribeRequestBody(subscription, 'x'.repeat(600))).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      userAgent: 'x'.repeat(512),
    });
    expect(subscribeRequestBody(subscription, '')).toMatchObject({ userAgent: null });
  });
});

describe('detectPushSupport（API共通仕様 B95）', () => {
  it('Service Worker・PushManager・Notification がそろえば supported', () => {
    installBrowser();
    expect(detectPushSupport()).toBe('supported');
  });

  it('iPhone でどれかが無く、ホーム画面から開いていなければ needsHomeScreen。ほかの端末は unsupported', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(detectPushSupport()).toBe('needsHomeScreen');
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 });
    expect(detectPushSupport()).toBe('needsHomeScreen'); // iPad（Mac と名乗る）
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/120', platform: 'Linux x86_64', maxTouchPoints: 0 });
    expect(detectPushSupport()).toBe('unsupported');
  });
});

describe('enablePush・disablePush（④）', () => {
  it('許可されると Service Worker を登録して購読を作り、必要な項目だけを POST する', async () => {
    const browser = installBrowser({ permission: 'default' });
    apiMock.mockResolvedValue({ enabled: true });
    expect(await enablePush()).toEqual({ status: 'enabled' });
    expect(browser.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(apiMock).toHaveBeenCalledWith('/api/push/subscribe', {
      method: 'POST',
      body: { endpoint: 'https://fcm.googleapis.com/fcm/send/new-endpoint', keys: { p256dh: 'p256dh-value', auth: 'auth-value' }, userAgent: expect.any(String) },
    });
  });

  it('許可されなければ（拒否・ダイアログを閉じた）購読を作らない', async () => {
    const browser = installBrowser({ permission: 'default' });
    browser.requestPermission.mockResolvedValueOnce('denied');
    expect(await enablePush()).toEqual({ status: 'permission', permission: 'denied' });
    browser.requestPermission.mockResolvedValueOnce('default');
    expect(await enablePush()).toEqual({ status: 'permission', permission: 'default' });
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('POST が失敗したら、ブラウザの購読を解除して、エラーを投げる', async () => {
    const browser = installBrowser({ permission: 'granted' });
    const error = Object.assign(new Error('500'), { status: 500, code: 'INTERNAL_ERROR' });
    apiMock.mockRejectedValue(error);
    await expect(enablePush()).rejects.toBe(error);
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('購読の作成に失敗し、古い購読が残っているときは、解除して1回だけ作り直す', async () => {
    const old = fakeSubscription('https://fcm.googleapis.com/fcm/send/old');
    const browser = installBrowser({ permission: 'granted', subscription: old });
    browser.subscribe.mockRejectedValueOnce(new Error('InvalidStateError'));
    apiMock.mockResolvedValue({ enabled: true });
    expect(await enablePush()).toEqual({ status: 'enabled' });
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledTimes(2);
  });

  it('Service Worker が10秒たっても動き出さなければ失敗（POST しない）', async () => {
    vi.useFakeTimers();
    const browser = installBrowser({ permission: 'granted' });
    browser.readyNever = true;
    const result = enablePush().catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(SW_READY_TIMEOUT_MS);
    expect(await result).toBeInstanceOf(Error);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('オフ：先に DELETE を呼び、成功してからブラウザの購読を解除する。失敗したら購読を残してエラーを投げる', async () => {
    const browser = installBrowser({ subscription: fakeSubscription(), permission: 'granted' });
    const error = Object.assign(new Error('503'), { status: 503, code: 'TEMPORARILY_UNAVAILABLE' });
    apiMock.mockRejectedValueOnce(error);
    await expect(disablePush()).rejects.toBe(error);
    expect(browser.subscription!.unsubscribe).not.toHaveBeenCalled();

    apiMock.mockResolvedValueOnce(undefined);
    await disablePush();
    expect(apiMock).toHaveBeenLastCalledWith('/api/push/subscribe', { method: 'DELETE', body: { endpoint: ENDPOINT } });
    expect(browser.subscription!.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
