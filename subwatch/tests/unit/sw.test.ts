// public/sw.js（04-12：install・activate・notificationclick。API共通仕様 B96、詳細_F-12 の手順7）
// sw.js を node:vm で読み込み、self（Service Worker の全体）を偽物にして、登録された処理を呼ぶ
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://subwatch.example.com';

type Listener = (event: Record<string, unknown>) => void;

interface FakeClient {
  url: string;
  navigate: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function loadServiceWorker(options: { clients?: FakeClient[] } = {}) {
  const listeners = new Map<string, Listener>();
  const clients = {
    matchAll: vi.fn(async () => options.clients ?? []),
    openWindow: vi.fn(async () => null),
    claim: vi.fn(async () => undefined),
  };
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(),
    location: new URL(`${ORIGIN}/sw.js`),
    clients,
    registration: { showNotification: vi.fn(async () => undefined) },
  };
  const code = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  vm.runInNewContext(code, { self, URL, console });
  return { listeners, clients, self };
}

// 処理を呼び、waitUntil に渡された Promise が終わるまで待つ
async function dispatch(listeners: Map<string, Listener>, type: string, event: Record<string, unknown>): Promise<void> {
  const waits: Promise<unknown>[] = [];
  listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

function notificationClick(data: unknown) {
  return { notification: { data, close: vi.fn() } };
}

function fakeClient(navigateResult: 'ok' | 'null' | 'throw' = 'ok'): FakeClient {
  const client: FakeClient = { url: `${ORIGIN}/settings`, navigate: vi.fn(), focus: vi.fn(async () => undefined) };
  client.navigate.mockImplementation(async () => {
    if (navigateResult === 'throw') throw new TypeError('not controlled');
    return navigateResult === 'null' ? null : client;
  });
  return client;
}

describe('sw.js', () => {
  it('install で skipWaiting()、activate で clients.claim() を呼ぶ', async () => {
    const { listeners, clients, self } = loadServiceWorker();
    await dispatch(listeners, 'install', {});
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
    await dispatch(listeners, 'activate', {});
    expect(clients.claim).toHaveBeenCalledTimes(1);
  });

  it('タップすると、開いている画面を url?from=push へ navigate してから focus する', async () => {
    const client = fakeClient('ok');
    const { listeners, clients } = loadServiceWorker({ clients: [client] });
    const event = notificationClick({ url: '/subscriptions/abc123', notificationId: 'n1' });
    await dispatch(listeners, 'notificationclick', event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/subscriptions/abc123?from=push`);
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it.each(['throw', 'null'] as const)('navigate が失敗したとき（%s）は openWindow で開く', async (result) => {
    const client = fakeClient(result);
    const { listeners, clients } = loadServiceWorker({ clients: [client] });
    await dispatch(listeners, 'notificationclick', notificationClick({ url: '/subscriptions/abc123', notificationId: 'n1' }));
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/subscriptions/abc123?from=push`);
  });

  it('開いている画面が無いときは openWindow で開く', async () => {
    const { listeners, clients } = loadServiceWorker({ clients: [] });
    await dispatch(listeners, 'notificationclick', notificationClick({ url: '/subscriptions/xyz', notificationId: 'n1' }));
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/subscriptions/xyz?from=push`);
  });

  it.each([
    ['ほかのオリジン', 'https://evil.example.com/a'],
    ['// で始まる', '//evil.example.com/a'],
    ['/ で始まらない', 'subscriptions/abc'],
    ['javascript:', 'javascript:alert(1)'],
    ['文字列でない', 123],
    ['無い', undefined],
  ])('url がアプリの中のパスでない（%s）ときは、ホームを開く', async (_name, url) => {
    const { listeners, clients } = loadServiceWorker({ clients: [] });
    await dispatch(listeners, 'notificationclick', notificationClick(url === undefined ? null : { url, notificationId: 'n1' }));
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
