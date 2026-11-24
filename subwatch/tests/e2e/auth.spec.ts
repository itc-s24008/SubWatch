// 登録（S-01）・ログイン（S-02）・ログアウトと再設定（S-09 ⑧⑨）・Gates の画面テスト（04-05）
// テスト一覧の No.16・17（あわせての分。C-4）・18・19・57（画面の部分）・63（画面の部分）・69 と、番号なしの C-4 の分岐・GET /api/account の回数
import { expect, test, type Page } from '@playwright/test';
import {
  accountResponse,
  callApi,
  createUser,
  expectNoHorizontalScroll,
  expectTapTargets,
  loginAsNewUser,
  mockApi,
  waitForHydration,
} from './helpers';

const OLD_VERSION = '2000-01-01';

let counter = 0;
function newEmail(): string {
  counter += 1;
  return `e2e${Date.now()}${counter}@example.com`;
}

// Firebase Auth（Emulator）への「ユーザーを作る」要求の数を数える
function countSignUps(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.url().includes('accounts:signUp')) count += 1;
  });
  return () => count;
}

async function openRegister(page: Page): Promise<void> {
  await page.goto('/register');
  await waitForHydration(page, 'form');
}

async function fillRegisterForm(page: Page, email: string, password = 'password1234', confirm = password): Promise<void> {
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByLabel('パスワード確認').fill(confirm);
}

function termsBox(page: Page) {
  return page.getByRole('checkbox', { name: /利用規約/ });
}
function privacyBox(page: Page) {
  return page.getByRole('checkbox', { name: /プライバシーポリシー/ });
}

async function openLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await waitForHydration(page, 'form');
}

async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
}

test.describe('S-01 ユーザー登録', () => {
  test('No.16 同意のチェックが2つそろうまで［アカウントを作成］を押せない。パスワード7文字では登録できない（C-16）', async ({ page }) => {
    const signUps = countSignUps(page);
    await openRegister(page);
    const create = page.getByRole('button', { name: 'アカウントを作成' });
    await fillRegisterForm(page, newEmail(), 'pass123', 'pass123');
    await expect(create).toBeDisabled();
    await termsBox(page).check();
    await expect(create).toBeDisabled();
    await privacyBox(page).check();
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.getByRole('alert').filter({ hasText: 'パスワードは8文字以上で入力してください' })).toBeVisible();
    await expect(page.getByText('パスワードは8文字以上で入力してください')).toHaveCount(1); // 同じ文を2つ並べない
    expect(signUps()).toBe(0);
    await expect(page).toHaveURL(/\/register$/);
  });

  test('確認用のパスワードが違うと「パスワードが一致しません」、メールが空だと「メールアドレスの形式が正しくありません」', async ({ page }) => {
    await openRegister(page);
    await fillRegisterForm(page, '', 'password1234', 'password9999');
    await termsBox(page).check();
    await privacyBox(page).check();
    await page.getByRole('button', { name: 'アカウントを作成' }).click();
    await expect(page.getByText('パスワードが一致しません')).toBeVisible();
    await expect(page.getByText('メールアドレスの形式が正しくありません')).toBeVisible();
  });

  test('登録すると、本物の bootstrap で users ができ、ホーム（S-03）へ移る', async ({ page }) => {
    await openRegister(page);
    await fillRegisterForm(page, newEmail());
    await termsBox(page).check();
    await privacyBox(page).check();
    await page.getByRole('button', { name: 'アカウントを作成' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    const account = await callApi(page, '/api/account');
    expect(account).toMatchObject({ ok: true, data: { pushSubscriptionIds: [] } });
  });

  test('No.17・C-4 bootstrap が 503 になると、同じ画面のまま入力欄が消え、チェックしたままの同意2つ・「初期設定をやり直す」・「ログアウト」だけが出て、押すと bootstrap だけが呼ばれる', async ({ page }) => {
    const signUps = countSignUps(page);
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
    await fillRegisterForm(page, email);
    await termsBox(page).check();
    await privacyBox(page).check();
    await page.getByRole('button', { name: 'アカウントを作成' }).click();

    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText('初期設定が完了していません。同意して、やり直してください')).toBeVisible();
    await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
    await expect(page.getByLabel('パスワード確認')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'アカウントを作成' })).toHaveCount(0);
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
    expect(signUps()).toBe(1); // ユーザーは作り直さない
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
    await fillRegisterForm(page, newEmail());
    await termsBox(page).check();
    await privacyBox(page).check();
    await page.getByRole('button', { name: 'アカウントを作成' }).click();
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
    await fillRegisterForm(page, newEmail());
    await termsBox(page).check();
    await privacyBox(page).check();
    await page.getByRole('button', { name: 'アカウントを作成' }).click();
    await expect(page).toHaveURL(/\/login$/);
    const flash = page.getByRole('status').filter({ hasText: '利用規約が更新されました。もう一度同意してください' });
    await expect(flash).toBeVisible();
    // お知らせは［ログイン］を押したら消える
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(flash).toHaveCount(0);
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
    await fillRegisterForm(page, newEmail());
    await termsBox(page).check();
    await privacyBox(page).check();
    await page.getByRole('button', { name: 'アカウントを作成' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('登録は完了しましたが初期設定に失敗しました。もう一度ログインしてください')).toBeVisible();
  });

  test('すでに登録されたメールでは「このメールアドレスはすでに登録されています」と、その下に S-02 へのリンク「ログインして続けてください」', async ({ page }) => {
    const user = await createUser();
    await openRegister(page);
    await fillRegisterForm(page, user.email);
    await termsBox(page).check();
    await privacyBox(page).check();
    await page.getByRole('button', { name: 'アカウントを作成' }).click();
    await expect(page.getByText('このメールアドレスはすでに登録されています')).toBeVisible();
    await page.getByRole('link', { name: 'ログインして続けてください' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('C-4 開いたときログイン済みで users が無い（404）なら、GET /api/account を1回だけ読み、チェックを外した「やり直す」表示。「ログアウト」で S-02 へ', async ({ page }) => {
    await loginAsNewUser(page, { initialized: false });
    const account = await mockApi(page, 'GET', '/api/account', { status: 404, error: { code: 'NOT_FOUND', message: '見つかりません' } });
    await page.goto('/register');
    await expect(page.getByText('初期設定が完了していません。同意して、やり直してください')).toBeVisible();
    await expect(termsBox(page)).not.toBeChecked();
    await expect(privacyBox(page)).not.toBeChecked();
    await expect(page.getByRole('button', { name: '初期設定をやり直す' })).toBeDisabled();
    await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
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
    await expect(page.getByLabel('メールアドレス')).toHaveCount(0);
    expect(account.calls()).toBe(1);
  });
});

test.describe('S-02 ログイン', () => {
  test('No.18 ログインしていないと、S-04 を開くと S-02 へ移る', async ({ page }) => {
    await page.goto('/subscriptions');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ログイン' })).toBeVisible();
  });

  test('No.19 誤ったパスワードでは「メールアドレスまたはパスワードが正しくありません」（登録の無いメール・空のときも同じ文）', async ({ page }) => {
    const user = await createUser({ initialized: true });
    await openLogin(page);
    const message = page.getByRole('alert').filter({ hasText: 'メールアドレスまたはパスワードが正しくありません' });
    await fillLogin(page, user.email, 'wrong-password');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(message).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await fillLogin(page, 'nobody@example.com', 'wrong-password');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(message).toBeVisible();

    await fillLogin(page, '', '');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(message).toBeVisible();
  });

  test('正しいログインで S-03 へ移る。「S-02 でログイン → S-03 → 下部ナビで S-09」で GET /api/account は2回（Gates と、04-21 の NotificationSection。AccountInfo は読まない）', async ({ page }) => {
    const user = await createUser({ initialized: true });
    const account = await mockApi(page, 'GET', '/api/account', accountResponse(user.email));
    await openLogin(page);
    await fillLogin(page, user.email, user.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await page.getByRole('navigation', { name: 'メニュー' }).getByRole('link', { name: '設定' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible(); // ②アカウント情報
    await expect.poll(() => account.calls()).toBe(2); // 04-21 で 1 → 2（決まりの一覧 C-9 の③）
  });

  test('No.69 再設定は、Auth に無いメール（nobody@example.com）と登録済みのメールで同じ文が出る', async ({ page }) => {
    const user = await createUser({ initialized: true });
    const sent = '再設定用のメールを送りました。届かない場合は迷惑メールフォルダを確認してください';
    await openLogin(page);
    await page.getByLabel('メールアドレス').fill('nobody@example.com');
    await page.getByRole('button', { name: 'パスワードを忘れた場合' }).click();
    await expect(page.getByText(sent)).toBeVisible();

    await openLogin(page);
    await page.getByLabel('メールアドレス').fill(user.email);
    await page.getByRole('button', { name: 'パスワードを忘れた場合' }).click();
    await expect(page.getByText(sent)).toBeVisible();
  });

  test('再設定で①が空なら、①の下に「メールアドレスを入力してください」と出して送らない', async ({ page }) => {
    let resetRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('accounts:sendOobCode')) resetRequests += 1;
    });
    await openLogin(page);
    await page.getByRole('button', { name: 'パスワードを忘れた場合' }).click();
    await expect(page.getByText('メールアドレスを入力してください')).toBeVisible();
    expect(resetRequests).toBe(0);
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

test.describe('S-09 ⑧⑨', () => {
  test('⑨ログアウトで S-02 へ移り、ログアウトの後は保護画面を開いても S-02 へ移る', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('⑧パスワードを再設定で、ボタンのすぐ下に「再設定用のメールを送りました」', async ({ page }) => {
    await loginAsNewUser(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'パスワードを再設定' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^再設定用のメールを送りました$/ })).toBeVisible();
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
