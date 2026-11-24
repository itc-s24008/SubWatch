// 画面のテストの道具（Playwright）。画面のテストは仮データ（NEXT_PUBLIC_USE_MOCKS）を使わない：Emulator でログインし、
// まだ無い API や失敗の場面は mockApi で応答を作る（統合のあとも同じテストが動くように）
// みんなが足すファイル：自分の見出し（// ===== 04-xx：… =====）の下に足す。ほかの人の行と、先頭の import は変えない
import { expect, type Page, type Request, type Route } from '@playwright/test';
import '../env';
import { seedUser, signUpUser } from '../emulator/helpers';

export interface TestUser {
  uid: string;
  email: string;
  password: string;
  token: string;
}

// ログインせずに、ユーザーだけ作る（Auth Emulator）。initialized: true なら users も作る（既定 false）
export async function createUser({ initialized = false }: { initialized?: boolean } = {}): Promise<TestUser> {
  const user = await signUpUser();
  if (initialized) await seedUser(user.uid, { email: user.email });
  return user;
}

// Emulator にユーザーを作り、画面を通さずにログイン済みにする。initialized: false なら users を作らない（既定 true）
// 呼んだ後、ページは /terms にいる。続けて page.goto で目的の画面を開く
export async function loginAsNewUser(page: Page, { initialized = true }: { initialized?: boolean } = {}): Promise<TestUser> {
  const user = await createUser({ initialized });
  await page.goto('/terms');
  await page.waitForFunction(() => window.__SUBWATCH_E2E__ !== undefined);
  await page.evaluate(({ email, password }) => window.__SUBWATCH_E2E__!.signIn(email, password), { email: user.email, password: user.password });
  return user;
}

// ---- mockApi ----
// await mockApi(page, method, path, responses) → { calls(), bodies() }
//   path：'/api/subscriptions/:id' のように :id を書ける。クエリ（'/api/calendar?month=2026-11'）を書くと、そのクエリのときだけ応答する
//   responses（1つでも配列でもよい。順番に返し、使い切ったら最後の応答を返し続ける）：
//     { data, status? }（status 省略は 200）／ { status, error }（error は { code, message, field?, details? }）／ { status: 204 }
//     'failure'（通信の失敗）／ 'noResponse'（応答を返さない。いつまでも待たせる）
//     data・error・204 の応答には delayMs（応答を遅らせる ms。30000 より長くてよい）を付けられる。'failure' には付けられない
//   同じ method・path は、後から登録したほうが先に使われる
//   calls()：呼ばれた回数（'noResponse' を含む）。bodies()：送られた本文（JSON。本文が無ければ null）の配列
export type MockReply =
  | { data: unknown; status?: number; delayMs?: number }
  | { status: number; error: { code: string; message: string; field?: string; details?: unknown[]; candidates?: unknown[] }; delayMs?: number }
  | { status: 204; delayMs?: number }
  | 'failure'
  | 'noResponse';

export interface MockHandle {
  calls(): number;
  bodies(): unknown[];
}

function pathMatches(pattern: string, pathname: string): boolean {
  const a = pattern.split('/');
  const b = pathname.split('/');
  return a.length === b.length && a.every((part, i) => part.startsWith(':') || part === b[i]);
}

function queryMatches(expected: URLSearchParams, actual: URLSearchParams): boolean {
  for (const [key, value] of expected) {
    if (actual.get(key) !== value) return false;
  }
  return true;
}

function bodyOf(request: Request): unknown {
  const text = request.postData();
  if (text === null || text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function mockApi(page: Page, method: string, path: string, responses: MockReply | MockReply[]): Promise<MockHandle> {
  const list = Array.isArray(responses) ? responses : [responses];
  const [pathname, query] = path.split('?');
  const expectedQuery = new URLSearchParams(query ?? '');
  const hasQuery = query !== undefined;
  let count = 0;
  const bodies: unknown[] = [];

  await page.route(
    (url) => pathMatches(pathname, url.pathname) && (!hasQuery || queryMatches(expectedQuery, url.searchParams)),
    async (route: Route) => {
      const request = route.request();
      if (request.method() !== method.toUpperCase()) {
        await route.fallback();
        return;
      }
      const reply = list[Math.min(count, list.length - 1)];
      count += 1;
      bodies.push(bodyOf(request));
      if (reply === 'noResponse') return; // 応答を返さない
      if (reply === 'failure') {
        await route.abort('failed');
        return;
      }
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      if ('error' in reply) {
        await route.fulfill({ status: reply.status, json: { data: null, error: reply.error, requestId: 'mock' } });
      } else if ('data' in reply) {
        await route.fulfill({ status: reply.status ?? 200, json: { data: reply.data, error: null, requestId: 'mock' } });
      } else {
        await route.fulfill({ status: 204, body: '' });
      }
    },
  );
  return { calls: () => count, bodies: () => [...bodies] };
}

// ---- callApi ----
// 画面から api() を呼ぶ（window.__SUBWATCH_E2E__ を使う。どのページでもよい）
// → { ok: true, data } か { ok: false, error: { status, code, message, field } }（エラーは画面の外へ渡せないので形を変える）
export type CallApiResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { status: number; code: string; message: string; field?: string } };

export async function callApi(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown; skipGate?: boolean; timeoutMs?: number } = {},
): Promise<CallApiResult> {
  await page.waitForFunction(() => window.__SUBWATCH_E2E__ !== undefined);
  return page.evaluate(
    async ({ path: p, options: o }) => {
      try {
        const data = await window.__SUBWATCH_E2E__!.api(p, o as Parameters<NonNullable<typeof window.__SUBWATCH_E2E__>['api']>[1]);
        return { ok: true as const, data };
      } catch (e) {
        const error = e as { status: number; code: string; message: string; field?: string };
        return { ok: false as const, error: { status: error.status, code: error.code, message: error.message, field: error.field } };
      }
    },
    { path, options },
  );
}

// React が動き出すまで待つ（page.goto の後、入力する前に呼ぶ）。selector の要素に React の印が付くのを待つ
export async function waitForHydration(page: Page, selector = 'form'): Promise<void> {
  await page.waitForFunction((sel) => {
    const element = document.querySelector(sel);
    return element !== null && Object.keys(element).some((key) => key.startsWith('__reactFiber') || key.startsWith('__reactProps'));
  }, selector);
}

// GET /api/account の正常な応答（mockApi に渡す形）。規約の版は .env.development.example の値
export function accountResponse(email: string, fields: Record<string, unknown> = {}): MockReply {
  return {
    data: {
      email,
      accountNotificationEnabled: true,
      termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION ?? '',
      privacyVersion: process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '',
      pushSubscriptionCount: 0,
      pushSubscriptionIds: [],
      ...fields,
    },
  };
}

// 横スクロールが出ていない（幅 375px などで呼ぶ）
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll, '横スクロールが出ている').toBeLessThanOrEqual(size.client);
}

// 見えているボタン・リンク・スイッチが縦横 44px 以上。文の中のリンク（<p>・<label> の中の <a>）は数えない
export async function expectTapTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() => {
    const result: string[] = [];
    const elements = document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [role="switch"], input[type="checkbox"], input[type="radio"]');
    for (const element of elements) {
      if (element.tagName === 'A' && element.closest('p, label')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // 見えていない
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let width = rect.width;
      let height = rect.height;
      const label = element.closest('label');
      if ((element as HTMLInputElement).type === 'checkbox' || (element as HTMLInputElement).type === 'radio') {
        // チェック欄・ラジオボタンは、押せる範囲（ラベルの行）で数える
        const row = label ?? element.parentElement;
        if (row) {
          const r = row.getBoundingClientRect();
          width = Math.max(width, r.width);
          height = Math.max(height, r.height);
        }
      }
      if (width < 43.5 || height < 43.5) {
        result.push(`${element.tagName.toLowerCase()}「${(element.textContent ?? element.getAttribute('aria-label') ?? '').trim()}」${Math.round(width)}×${Math.round(height)}`);
      }
    }
    return result;
  });
  expect(small, `44px より小さい：${small.join('、')}`).toEqual([]);
}

// ===== 04-05：認証の画面テストの道具 ここに足す =====

// ===== 04-06：S-05 の画面テストの道具 ここに足す =====

// ===== 05-07：mockFavicon ここに足す =====
