// 仮データ（開発中に NEXT_PUBLIC_USE_MOCKS=true のときだけ、lib/api-client.ts の api() が使う。本番のビルドには入らない）
//
// - 値は、機能設計書「テストデータ」と画面設計書「サンプルデータ」の基準日 2026-11-04 のもの。
//   今日から計算する表示（残り日数・今週の合計など）は、今日が 2026-11-04 でなければ図と違うことがある。
// - 仮データは検証と請求日の計算をしない（本物の API では 400 もある）。nextBillingDate は送られた請求日のままにする。
// - mockResponse(method, path, body) の戻り値は、画面テストの mockApi の応答と同じ形：
//     { data, status? }（status 省略は 200）／ { status, error }／ { status: 204 }
//   登録の無い API は 501 を返す。ここにある API：API一覧の No.1・2・5〜10（04-05〜04-09 が使う）
// - みんなが足すファイル：自分の見出し（// ===== 04-xx：… =====）の下に足す。ほかの人の行は変えない
import type {
  AccountDto,
  ApiError,
  BootstrapResult,
  CreateSubscriptionBody,
  DashboardDto,
  SubscriptionDto,
  SubscriptionListDto,
  SubscriptionResponse,
} from '@/lib/types';

export type MockResult = { data: unknown; status?: number } | { status: number; error: ApiError } | { status: 204 };

type Params = Record<string, string>;
type MockHandler = (params: Params, body: unknown) => MockResult | Promise<MockResult>;
interface MockRoute {
  method: string;
  pattern: string; // 例 '/api/subscriptions/:id'
  handler: MockHandler;
}

const routes: MockRoute[] = [];

// 仮の API を登録する（後から登録したものが先に使われる）
export function addMockRoute(method: string, pattern: string, handler: MockHandler): void {
  routes.unshift({ method, pattern, handler });
}

function match(pattern: string, path: string): Params | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i];
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (part !== pathParts[i]) return null;
  }
  return params;
}

export async function mockResponse(method: string, path: string, body?: unknown): Promise<MockResult> {
  const pathOnly = path.split('?')[0];
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = match(route.pattern, pathOnly);
    if (params) return route.handler(params, body);
  }
  return { status: 501, error: { code: 'NOT_IMPLEMENTED', message: `仮データがありません（${method} ${pathOnly}）` } };
}

function notFound(message = '見つかりません'): MockResult {
  return { status: 404, error: { code: 'NOT_FOUND', message } };
}

// ---- テストデータ（基準日 2026-11-04。登録の順は表の行の順で、いちばん上がいちばん古い） ----
const MOCK_EMAIL = 'demo@example.com';

function makeSubscription(
  index: number,
  fields: Pick<SubscriptionDto, 'serviceName' | 'price' | 'billingCycle' | 'firstBillingDate' | 'billingDayMode' | 'category' | 'nextBillingDate'> &
    Partial<SubscriptionDto>,
): SubscriptionDto {
  const createdAt = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString();
  return {
    subscriptionId: `mockSubscription${String(index).padStart(4, '0')}`, // 英数字20文字
    planName: null,
    trialEnabled: false,
    trialEndDate: null,
    websiteUrl: null,
    cancelUrl: null,
    paymentMethod: null,
    memo: null,
    subscriptionNotificationEnabled: true,
    createdAt,
    updatedAt: createdAt,
    ...fields,
  };
}

function initialSubscriptions(): SubscriptionDto[] {
  return [
    makeSubscription(1, {
      serviceName: 'Netflix',
      planName: 'スタンダード',
      price: 1590,
      billingCycle: 'monthly',
      firstBillingDate: '2026-10-08',
      billingDayMode: 'fixedDay',
      category: 'video',
      nextBillingDate: '2026-11-08',
      websiteUrl: 'https://www.netflix.com',
      paymentMethod: 'メインカード',
    }),
    makeSubscription(2, {
      serviceName: 'Spotify',
      price: 980,
      billingCycle: 'monthly',
      firstBillingDate: '2026-09-05',
      billingDayMode: 'fixedDay',
      category: 'music',
      nextBillingDate: '2026-11-05',
    }),
    makeSubscription(3, {
      serviceName: 'Adobe Creative Cloud',
      price: 6480,
      billingCycle: 'monthly',
      firstBillingDate: '2026-10-11',
      billingDayMode: 'fixedDay',
      category: 'cloud',
      nextBillingDate: '2026-11-11',
    }),
    makeSubscription(4, {
      serviceName: 'iCloud+',
      price: 12000,
      billingCycle: 'yearly',
      firstBillingDate: '2025-12-01',
      billingDayMode: 'fixedDay',
      category: 'cloud',
      nextBillingDate: '2026-12-01',
    }),
    makeSubscription(5, {
      serviceName: 'ChatGPT',
      price: 3000,
      billingCycle: 'monthly',
      firstBillingDate: '2026-11-30',
      billingDayMode: 'endOfMonth',
      category: 'ai',
      nextBillingDate: '2026-11-30',
      trialEnabled: true,
      trialEndDate: '2026-11-10',
    }),
  ];
}

// 仮データの状態（ページを読み込み直すと最初に戻る）
let subscriptions: SubscriptionDto[] = initialSubscriptions();
let nextIndex = 6;

export function resetMockData(): void {
  subscriptions = initialSubscriptions();
  nextIndex = 6;
}

function duplicateKey(name: string): string {
  return name.replace(/^[\s　]+|[\s　]+$/g, '').replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// ---- 04-01 が置いた仮データ：アカウント（API一覧 No.1・2） ----
addMockRoute('POST', '/api/account/bootstrap', () => ({ data: { uid: 'mock-uid', initialized: true } satisfies BootstrapResult }));
addMockRoute('GET', '/api/account', () => ({
  data: {
    email: MOCK_EMAIL,
    accountNotificationEnabled: true,
    termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION ?? '',
    privacyVersion: process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '',
    pushSubscriptionCount: 0,
    pushSubscriptionIds: [],
  } satisfies AccountDto,
}));

// ---- 04-01 が置いた仮データ：サブスクの登録（API一覧 No.7。同名の 409 を含む） ----
addMockRoute('POST', '/api/subscriptions', (_params, body) => {
  const input = (body ?? {}) as CreateSubscriptionBody;
  const name = typeof input.serviceName === 'string' ? input.serviceName.trim() : '';
  const sameName = subscriptions.filter((s) => duplicateKey(s.serviceName) === duplicateKey(name));
  if (sameName.length > 0 && input.confirmDuplicate !== true) {
    return {
      status: 409,
      error: {
        code: 'DUPLICATE_CANDIDATE',
        message: `『${name}』はすでに登録されています。別の契約として登録しますか？`,
        candidates: sameName.map((s) => ({ subscriptionId: s.subscriptionId, serviceName: s.serviceName })),
      },
    };
  }
  const { confirmDuplicate: _ignored, ...fields } = input;
  void _ignored;
  const created = makeSubscription(nextIndex, {
    ...fields,
    serviceName: name,
    nextBillingDate: input.firstBillingDate, // 仮データは請求日の計算をしない
  });
  nextIndex += 1;
  subscriptions = [...subscriptions, created];
  return { status: 201, data: { subscription: created } satisfies SubscriptionResponse };
});

// ---- 04-01 が置いた仮データ：サブスクの一覧・1件（API一覧 No.5・6） ----
addMockRoute('GET', '/api/subscriptions', () => ({
  data: { items: subscriptions, totalCount: subscriptions.length } satisfies SubscriptionListDto,
}));
addMockRoute('GET', '/api/subscriptions/:id', ({ id }) => {
  const found = subscriptions.find((s) => s.subscriptionId === id);
  return found ? { data: { subscription: found } satisfies SubscriptionResponse } : notFound('サブスクが見つかりません');
});

// ---- 04-01 が置いた仮データ：サブスクの変更・削除（API一覧 No.8・9） ----
addMockRoute('PATCH', '/api/subscriptions/:id', ({ id }, body) => {
  const index = subscriptions.findIndex((s) => s.subscriptionId === id);
  if (index < 0) return notFound('サブスクが見つかりません');
  const updated: SubscriptionDto = {
    ...subscriptions[index],
    ...((body ?? {}) as Partial<SubscriptionDto>),
    subscriptionId: subscriptions[index].subscriptionId,
    updatedAt: new Date().toISOString(),
  };
  subscriptions = subscriptions.map((s, i) => (i === index ? updated : s));
  return { data: { subscription: updated } satisfies SubscriptionResponse };
});
addMockRoute('DELETE', '/api/subscriptions/:id', ({ id }) => {
  const exists = subscriptions.some((s) => s.subscriptionId === id);
  if (!exists) return notFound('サブスクが見つかりません');
  subscriptions = subscriptions.filter((s) => s.subscriptionId !== id);
  return { status: 204 };
});

// ---- 04-01 が置いた仮データ：ホーム（API一覧 No.10。値は基準日 2026-11-04 の期待値） ----
addMockRoute('GET', '/api/dashboard', () => ({
  data: {
    weekTotal: { count: 2, amountJPY: 2570 },
    monthTotal: { count: 4, amountJPY: 12050 },
    monthlyEquivalentJPY: 13050,
    yearlyEquivalentJPY: 156600,
    subscriptionCount: subscriptions.length,
    unreadCount: 1,
    nextBills: [
      { subscriptionId: 'mockSubscription0002', serviceName: 'Spotify', websiteUrl: null, date: '2026-11-05', priceJPY: 980, daysLeft: 1 },
      {
        subscriptionId: 'mockSubscription0001',
        serviceName: 'Netflix',
        websiteUrl: 'https://www.netflix.com',
        date: '2026-11-08',
        priceJPY: 1590,
        daysLeft: 4,
      },
      {
        subscriptionId: 'mockSubscription0003',
        serviceName: 'Adobe Creative Cloud',
        websiteUrl: null,
        date: '2026-11-11',
        priceJPY: 6480,
        daysLeft: 7,
      },
    ],
  } satisfies DashboardDto,
}));

// ===== 04-05：認証 ここに足す =====

// ===== 04-06：S-05 登録 ここに足す =====

// ===== 04-07：サブスクの API ここに足す =====

// ===== 04-08：S-05 編集と削除 ここに足す =====

// ===== 04-09：ホームと一覧 ここに足す =====

// ===== 04-12：Push 購読（POST・DELETE /api/push/subscribe） ここに足す =====
// 仮データは検証をしない（本物では endpoint などの 400 もある）。GET /api/account の pushSubscriptionIds は空のままなので、
// 仮データで開き直すと、S-09 ⑤の確認でブラウザの購読が解除される（本物の API で試すときは起きない）
addMockRoute('POST', '/api/push/subscribe', () => ({ data: { enabled: true } }));
addMockRoute('DELETE', '/api/push/subscribe', () => ({ status: 204 }));

// ===== 04-13：カレンダー（GET /api/calendar） ここに足す =====

// ===== 04-17：アカウント削除（DELETE /api/account） ここに足す =====
// いつも 200 {status:'deleted'}（仮データは何も消さない。画面の②の再認証は Firebase へ行くので、仮データでもログインしていないと進めない）
addMockRoute('DELETE', '/api/account', () => ({ data: { status: 'deleted' } }));

// ===== 04-21：通知（GET /api/notifications など）・PATCH /api/account ここに足す =====
// 値は画面設計書「サンプルデータ」B23・B26：今日（2026-11-04）の Cron で作られた2件（Spotify 1日前・Adobe Creative Cloud 7日前）で、
// Adobe Creative Cloud は既読（未読は1件）。作成時刻は日本時間 09:00。仮データは filter・limit・cursor を見ない（mockResponse は
// handler にクエリを渡さないため。04-01 の行は変えない）。どのフィルターでも2件を返し、続きは無い（nextCursor は null）。
// 既読・すべて既読・PATCH /api/account は、ページを読み込み直すまで覚えている（GET /api/account の accountNotificationEnabled は 04-01 の値のまま）
import type { MarkReadResult, NotificationDto, NotificationListDto, ReadAllResult, UpdateAccountResult } from '@/lib/types';

function initialNotifications(): NotificationDto[] {
  const createdAt = '2026-11-04T00:00:00.000Z'; // 日本時間 2026-11-04 09:00
  return [
    {
      notificationId: '2'.repeat(64),
      subscriptionId: 'mockSubscription0002',
      serviceNameAtNotification: 'Spotify',
      notificationType: 'billing',
      daysBefore: 1,
      targetDate: '2026-11-04',
      title: '請求日まであと1日',
      body: '11/05・¥980 の請求予定',
      priceAtNotification: 980,
      subscriptionExists: true,
      viewedAt: null,
      webPushStatus: 'sent',
      createdAt,
    },
    {
      notificationId: '1'.repeat(64),
      subscriptionId: 'mockSubscription0003',
      serviceNameAtNotification: 'Adobe Creative Cloud',
      notificationType: 'billing',
      daysBefore: 7,
      targetDate: '2026-11-04',
      title: '請求日まであと7日',
      body: '11/11・¥6,480 の請求予定',
      priceAtNotification: 6480,
      subscriptionExists: true,
      viewedAt: createdAt,
      webPushStatus: 'sent',
      createdAt,
    },
  ];
}

let mockNotifications: NotificationDto[] = initialNotifications();

function mockNotificationList(): NotificationListDto {
  // subscriptionExists は、仮データのサブスク（削除できる）に今もあるか
  const items = mockNotifications.map((item) => ({ ...item, subscriptionExists: subscriptions.some((s) => s.subscriptionId === item.subscriptionId) }));
  return { items, nextCursor: null, unreadCount: mockNotifications.filter((item) => item.viewedAt === null).length };
}

addMockRoute('GET', '/api/notifications', () => ({ data: mockNotificationList() }));
addMockRoute('POST', '/api/notifications/:id/read', ({ id }) => {
  const found = mockNotifications.find((item) => item.notificationId === id);
  if (!found) return notFound();
  const viewedAt = found.viewedAt ?? new Date().toISOString();
  mockNotifications = mockNotifications.map((item) => (item.notificationId === id ? { ...item, viewedAt } : item));
  return { data: { viewedAt } satisfies MarkReadResult };
});
addMockRoute('POST', '/api/notifications/read-all', () => {
  const now = new Date().toISOString();
  const updatedCount = mockNotifications.filter((item) => item.viewedAt === null).length;
  mockNotifications = mockNotifications.map((item) => (item.viewedAt === null ? { ...item, viewedAt: now } : item));
  return { data: { updatedCount } satisfies ReadAllResult };
});
addMockRoute('PATCH', '/api/account', (_params, body) => {
  const value = (body as { accountNotificationEnabled?: unknown } | null)?.accountNotificationEnabled;
  if (typeof value !== 'boolean') {
    return { status: 400, error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください', field: 'accountNotificationEnabled' } };
  }
  return { data: { accountNotificationEnabled: value } satisfies UpdateAccountResult };
});
