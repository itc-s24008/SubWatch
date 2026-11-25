// 登録（S-01）・ログイン（S-02）・ログアウト（S-09 ⑨）・Gates の画面テスト（04-05）
// テスト一覧の No.16・17（あわせての分。C-4）・18・57（画面の部分）・63（画面の部分）と、番号なしの C-4 の分岐・GET /api/account の回数
// ログインは Google だけ（決まりの一覧 C-19）。Auth Emulator のポップアップでアカウントを選ぶ（signInWithGooglePopup）。
// パスワードの長さ（No.16 の後半）・誤ったパスワード（No.19）・再設定メール（No.69）・S-09 ⑧は、機能が無くなったので、無いことを確かめる
import { expect, test, type Page } from '@playwright/test';
import {
  accountResponse,
  callApi,
  createUser,
  expectNoHorizontalScroll,
  chooseGoogleAccount,
  expectTapTargets,
  loginAsNewUser,
  mockApi,
  signInWithGooglePopup,
  waitForHydration,
} from './helpers';

const OLD_VERSION = '2000-01-01';

let counter = 0;
function newEmail(): string {
  counter += 1;
  return `e2e${Date.now()}${counter}@example.com`;
}

// Firebase Auth（Emulator）への「Google でログインする」要求の数を数える（初めてのアカウントなら、ここでユーザーができる）
function countGoogleSignIns(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.url().includes('accounts:signInWithIdp')) count += 1;
  });
  return () => count;
}

async function openRegister(page: Page): Promise<void> {
  await page.goto('/register');
  await waitForHydration(page, 'main button');
}

// 同意の2つにチェックして［Googleで登録］→ ポップアップでアカウントを選ぶ
async function registerWithGoogle(page: Page, email: string): Promise<void> {
  await termsBox(page).check();
  await privacyBox(page).check();
  await signInWithGooglePopup(page, 'Googleで登録', email);
}

function termsBox(page: Page) {
  return page.getByRole('checkbox', { name: /利用規約/ });
}
function privacyBox(page: Page) {
  return page.getByRole('checkbox', { name: /プライバシーポリシー/ });
}

async function openLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await waitForHydration(page, 'main button');
}

test.describe('S-01 ユーザー登録', () => {
  test('No.16 同意のチェックが2つそろうまで［Googleで登録］を押せない。メールとパスワードの入力欄は無い（C-19）', async ({ page }) => {
    const signIns = countGoogleSignIns(page);
    await openRegister(page);
    const create = page.getByRole('button', { name: 'Googleで登録' });
    await expect(create).toBeDisabled();
    await termsBox(page).check();
    await expect(create).toBeDisabled();
    await privacyBox(page).check();
    await expect(create).toBeEnabled();
    await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
    await expect(page.getByLabel(/パスワード/)).toHaveCount(0);
    expect(signIns()).toBe(0);
  });

  test('ポップアップを閉じると、文を出さずに S-01 のまま、もう一度［Googleで登録］を押せる', async ({ page }) => {
    await openRegister(page);
    await termsBox(page).check();
    await privacyBox(page).check();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Googleで登録' }).click();
    await (await popupPromise).close();
    await expect(page.getByRole('button', { name: 'Googleで登録' })).toBeEnabled();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page).toHaveURL(/\/register$/);
  });

  test('Google で登録すると、本物の bootstrap で users ができ、ホーム（S-03）へ移る', async ({ page }) => {
    const email = newEmail();
    await openRegister(page);
    await registerWithGoogle(page, email);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    const account = await callApi(page, '/api/account');
    expect(account).toMatchObject({ ok: true, data: { email, pushSubscriptionIds: [] } });
  });

  test('No.17・C-4 bootstrap が 503 になると、同じ画面のまま入力欄が消え、チェックしたままの同意2つ・「初期設定をやり直す」・「ログアウト」だけが出て、押すと bootstrap だけが呼ばれる', async ({ page }) => {
    const signIns = countGoogleSignIns(page);
    const email = newEmail();
    const bootstrap = await mockApi(page, 'POST', '/api/account/bootstrap', [
      { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
      { data: { uid: 'mock', initialized: true } },
    ]);
    const account = await mockApi(page, 'GET', '/api/account', accountResponse(email));
    // 04-09：ホームが GET /api/dashboard を読むようになった（bootstrap を mockApi にしたので users が無く、本物は 409 になる）
    await mockApi(page, 'GET', '/api/dashboard', {
      data: {
        weekTotal: { count: 0, amountJPY: 0 },
        monthTotal: { count: 0, amountJPY: 0 },
        monthlyEquivalentJPY: 0,
        yearlyEquivalentJPY: 0,
        subscriptionCount: 0,
        unreadCount: 0,
        nextBills: [],
      },
    });
    await openRegister(page);
    await registerWithGoogle(page, email);

    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText('初期設定が完了していません。同意して、やり直してください')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Googleで登録' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
    await expect(termsBox(page)).toBeChecked();
    await expect(privacyBox(page)).toBeChecked();
    const retry = page.getByRole('button', { name: '初期設定をやり直す' });
    await expect(retry).toBeEnabled();
    await termsBox(page).uncheck();
    await expect(retry).toBeDisabled();
    await termsBox(page).check();
    await expect(retry).toBeEnabled();

    await retry.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    expect(bootstrap.calls()).toBe(2);
    expect(signIns()).toBe(1); // Google のログインはやり直さない
    expect(bootstrap.bodies()[1]).toEqual({
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION,
      privacyVersion: process.env.NEXT_PUBLIC_PRIVACY_VERSION,
    });
    expect(account.calls()).toBe(1); // 登録の送信中は S-01 が読まない（1回はホームの Gates）
  });

  test('C-4 bootstrap が通信の失敗（status 0）でも「やり直す」表示に切り替わり、文は「登録できませんでした。もう一度お試しください」', async ({ page }) => {
    await mockApi(page, 'POST', '/api/account/bootstrap', 'failure');
    await openRegister(page);
    await registerWithGoogle(page, newEmail());
    await expect(page.getByRole('alert').filter({ hasText: '登録できませんでした。もう一度お試しください' })).toBeVisible();
    await expect(page.getByRole('button', { name: '初期設定をやり直す' })).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('C-4 bootstrap が 409（版違い）なら、サインアウトして S-02 に「利用規約が更新されました。もう一度同意してください」', async ({ page }) => {
    await mockApi(page, 'POST', '/api/account/bootstrap', {
      status: 409,
      error: { code: 'TERMS_RECONSENT_REQUIRED', message: '利用規約が更新されました。もう一度同意してください' },
    });
    await openRegister(page);
    await registerWithGoogle(page, newEmail());
    await expect(page).toHaveURL(/\/login$/);
    const flash = page.getByRole('status').filter({ hasText: '利用規約が更新されました。もう一度同意してください' });
    await expect(flash).toBeVisible();
    // お知らせは［Googleでログイン］を押したら消える（開いたポップアップは閉じる）
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Googleでログイン' }).click();
    await expect(flash).toHaveCount(0);
    await (await popupPromise).close();
    // サインアウトしている
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('C-4 bootstrap がそれ以外（500 INTERNAL_ERROR）なら、サインアウトして S-02 に「登録は完了しましたが初期設定に失敗しました…」', async ({ page }) => {
    await mockApi(page, 'POST', '/api/account/bootstrap', {
      status: 500,
      error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました。もう一度お試しください' },
    });
    await openRegister(page);
    await registerWithGoogle(page, newEmail());
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('登録は完了しましたが初期設定に失敗しました。もう一度ログインしてください')).toBeVisible();
  });

  test('すでに登録済みの Google アカウントで［Googleで登録］を押しても、users は作り直さず（同意の記録も増やさず）ホーム（S-03）へ移る', async ({ page }) => {
    const user = await createUser({ initialized: true });
    await openRegister(page);
    await registerWithGoogle(page, user.email);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    const account = await callApi(page, '/api/account');
    expect(account).toMatchObject({ ok: true, data: { email: user.email } });
  });

  test('C-4 開いたときログイン済みで users が無い（404）なら、GET /api/account を1回だけ読み、チェックを外した「やり直す」表示。「ログアウト」で S-02 へ', async ({ page }) => {
    await loginAsNewUser(page, { initialized: false });
    const account = await mockApi(page, 'GET', '/api/account', { status: 404, error: { code: 'NOT_FOUND', message: '見つかりません' } });
    await page.goto('/register');
    await expect(page.getByText('初期設定が完了していません。同意して、やり直してください')).toBeVisible();
    await expect(termsBox(page)).not.toBeChecked();
    await expect(privacyBox(page)).not.toBeChecked();
    await expect(page.getByRole('button', { name: '初期設定をやり直す' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Googleで登録' })).toHaveCount(0);
    expect(account.calls()).toBe(1);
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('C-4 開いたときログイン済みで users がある（200）なら、ホーム（S-03）へ移る', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/register');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
  });

  test('C-4 開いたときに GET /api/account を読めない（503）と「読み込めませんでした。ページを再読み込みしてください」だけで、［再試行］は出さない', async ({ page }) => {
    await loginAsNewUser(page);
    const account = await mockApi(page, 'GET', '/api/account', {
      status: 503,
      error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' },
    });
    await page.goto('/register');
    await expect(page.getByText('読み込めませんでした。ページを再読み込みしてください')).toBeVisible();
    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '再試行' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Googleで登録' })).toHaveCount(0);
    expect(account.calls()).toBe(1);
  });
});

test.describe('S-02 ログイン', () => {
  test('No.18 ログインしていないと、S-04 を開くと S-02 へ移る', async ({ page }) => {
    await page.goto('/subscriptions');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ログイン' })).toBeVisible();
  });

  test('S-02 は［Googleでログイン］だけ（メール・パスワードの入力欄と「パスワードを忘れた場合」は無い。C-19）。ポップアップを閉じると文を出さない', async ({ page }) => {
    await openLogin(page);
    await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
    await expect(page.getByLabel(/パスワード/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'パスワードを忘れた場合' })).toHaveCount(0);
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Googleでログイン' }).click();
    await (await popupPromise).close();
    await expect(page.getByRole('button', { name: 'Googleでログイン' })).toBeEnabled();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('正しいログインで S-03 へ移る。「S-02 でログイン → S-03 → 下部ナビで S-09」で GET /api/account は2回（Gates と、04-21 の NotificationSection。AccountInfo は読まない）', async ({ page }) => {
    const user = await createUser({ initialized: true });
    const account = await mockApi(page, 'GET', '/api/account', accountResponse(user.email));
    await openLogin(page);
    await signInWithGooglePopup(page, 'Googleでログイン', user.email);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '設定' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible(); // ②アカウント情報
    await expect.poll(() => account.calls()).toBe(2); // 04-21 で 1 → 2（決まりの一覧 C-9 の③）
  });

  test('初めての Google アカウントで S-02 からログインすると、S-13（同意の確認）が出て、同意すると users ができてホームへ移る', async ({ page }) => {
    const email = newEmail();
    await openLogin(page);
    await signInWithGooglePopup(page, 'Googleでログイン', email);
    await expect(page.getByRole('heading', { level: 1, name: '同意の確認' })).toBeVisible();
    await page.getByRole('checkbox', { name: /利用規約/ }).check();
    await page.getByRole('checkbox', { name: /プライバシーポリシー/ }).check();
    await page.getByRole('button', { name: '同意して続ける' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    expect(await callApi(page, '/api/account')).toMatchObject({ ok: true, data: { email } });
  });

  test('C-7 ログイン済みのまま［Googleでログイン］を押すと、先にログアウトしてから、選んだ別のアカウントでログインする', async ({ page }) => {
    const first = await loginAsNewUser(page);
    const second = await createUser({ initialized: true });
    await openLogin(page);
    expect(await callApi(page, '/api/account')).toMatchObject({ ok: true, data: { email: first.email } });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Googleでログイン' }).click();
    await chooseGoogleAccount(await popupPromise, second.email);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    expect(await callApi(page, '/api/account')).toMatchObject({ ok: true, data: { email: second.email } });
  });
});

test.describe('Gates と onApiGate', () => {
  test('No.63 API が 401 UNAUTHENTICATED を返すと、登録した後始末が1回呼ばれ、サインアウトして S-02 に「ログインの有効期限が切れました…」が出る', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { cleanupCalls: number };
      w.cleanupCalls = 0;
      window.__SUBWATCH_E2E__!.registerLocalCleanup(() => {
        w.cleanupCalls += 1;
      });
    });
    await mockApi(page, 'GET', '/api/smoke-test', { status: 401, error: { code: 'UNAUTHENTICATED', message: 'ログインしてください' } });
    expect(await callApi(page, '/api/smoke-test')).toMatchObject({ ok: false, error: { status: 401, code: 'UNAUTHENTICATED' } });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: 'ログインの有効期限が切れました。もう一度ログインしてください' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { cleanupCalls: number }).cleanupCalls)).toBe(1);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('No.57 保存された規約の版が古いと S-13 を出し（下部ナビなし）、同意（チェック2つ →［同意して続ける］。04-19 で本物の操作に直した）の後は GET /api/account を読み直してホームへ移る', async ({ page }) => {
    const user = await loginAsNewUser(page);
    const account = await mockApi(page, 'GET', '/api/account', [
      accountResponse(user.email, { termsVersion: OLD_VERSION, privacyVersion: OLD_VERSION }),
      accountResponse(user.email),
    ]);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '同意の確認' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'メニュー' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: /利用規約/ }).check();
    await page.getByRole('checkbox', { name: /プライバシーポリシー/ }).check();
    await page.getByRole('button', { name: '同意して続ける' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
    // 04-21 で 2 → 3：Gates の2回（最初と、同意の後の読み直し）と、同意の後にホームへ移る前に一度出る S-09 の③（NotificationSection）の1回
    await expect.poll(() => account.calls()).toBe(3);
  });

  test('No.57 利用中に API が 409 TERMS_RECONSENT_REQUIRED を返すと S-13 に切り替わる', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    await mockApi(page, 'GET', '/api/smoke-test', {
      status: 409,
      error: { code: 'TERMS_RECONSENT_REQUIRED', message: '利用規約が更新されました。もう一度同意してください' },
    });
    await callApi(page, '/api/smoke-test');
    await expect(page.getByRole('heading', { level: 1, name: '同意の確認' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toHaveCount(0);
  });

  test('users の無い人がログインすると（GET /api/account が404）S-13 を出す', async ({ page }) => {
    await loginAsNewUser(page, { initialized: false });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '同意の確認' })).toBeVisible();
  });

  test('Gates が GET /api/account を読めない（503）と、ログインしたまま共通の文と［再試行］を出し、再試行で読めれば画面を出す', async ({ page }) => {
    const user = await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/account', [
      { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
      accountResponse(user.email),
    ]);
    await page.goto('/settings');
    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toBeVisible();
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  });
});

test.describe('S-09 ⑨（⑧は無い）', () => {
  test('⑨ログアウトで S-02 へ移り、ログアウトの後は保護画面を開いても S-02 へ移る', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('⑧パスワードを再設定は無い（ログインは Google だけ。C-19）', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'パスワードを再設定' })).toHaveCount(0);
  });
});

test.describe('見た目', () => {
  test('S-01・S-02 は幅375pxで横スクロールなし・押せる大きさ44px以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openRegister(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await openLogin(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });
});
