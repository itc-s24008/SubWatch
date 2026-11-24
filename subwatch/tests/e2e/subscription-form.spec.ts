// S-05 登録画面の画面テスト（04-06）。期待値は機能設計書「テスト一覧」No.8・9・11・41・65、画面設計書 S-05・状態・ダイアログ一覧 S-05 の行
// API は mockApi で作る（仮データ〔NEXT_PUBLIC_USE_MOCKS〕は使わない。04-07 の API が入った後も同じテストが動くように）
import { expect, test, type Page } from '@playwright/test';
import {
  accountResponse,
  expectNoHorizontalScroll,
  expectTapTargets,
  fillSubscriptionForm,
  loginAsNewUser,
  mockApi,
  subscriptionDto,
  waitForHydration,
  type MockReply,
} from './helpers';

const CREATED_ID = 'newSubscription00001';

const NETFLIX_INPUT = {
  serviceName: 'Netflix',
  planName: 'スタンダード',
  price: '1590',
  billingCycle: 'monthly',
  firstBillingDate: '2026-10-08',
  category: 'video',
};

function created(fields: Parameters<typeof subscriptionDto>[0] = {}, delayMs?: number): MockReply {
  return { status: 201, data: { subscription: subscriptionDto({ subscriptionId: CREATED_ID, ...fields }) }, delayMs };
}

// ログインして S-05（新規）を開く。Gates（04-05）が読む GET /api/account と、保存の後に開く S-06 の GET（04-08）は、正常な応答を置く
async function openNewForm(page: Page) {
  const user = await loginAsNewUser(page);
  await mockApi(page, 'GET', '/api/account', accountResponse(user.email));
  await mockApi(page, 'GET', '/api/subscriptions', { data: { items: [], totalCount: 0 } });
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: subscriptionDto({ subscriptionId: CREATED_ID }) } });
  await page.goto('/subscriptions/new');
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを追加' })).toBeVisible();
  await waitForHydration(page, 'form');
  return user;
}

function saveButton(page: Page) {
  return page.getByRole('main').getByRole('button', { name: /^(保存する|保存中…)$/ });
}

test('No.8 必須項目が空のまま保存すると、入力欄の下にエラーが出て、API は呼ばれない', async ({ page }) => {
  await openNewForm(page);
  const post = await mockApi(page, 'POST', '/api/subscriptions', created());
  const main = page.getByRole('main');

  await saveButton(page).click();

  // エラーは入力欄の下に出し、aria-describedby で入力欄と結びつける
  await expect(main.getByRole('textbox', { name: 'サービス名', exact: true })).toHaveAccessibleDescription('サービス名を入力してください');
  await expect(main.getByRole('textbox', { name: '1回の請求額（円）', exact: true })).toHaveAccessibleDescription('請求額は0〜10,000,000の整数で入力してください');
  await expect(main.getByRole('combobox', { name: '請求周期', exact: true })).toHaveAccessibleDescription('請求周期を選んでください');
  await expect(main.getByRole('textbox', { name: '請求日（過去に請求された日、または次の請求日）', exact: true })).toHaveAccessibleDescription(
    '正しい日付を選んでください',
  );
  await expect(main.getByRole('alert')).toHaveCount(4);
  // 押した後、エラーが残っている間は押せない
  await expect(saveButton(page)).toBeDisabled();
  expect(post.calls()).toBe(0);

  // 直すとエラーが消え、押せるようになる
  await fillSubscriptionForm(page, NETFLIX_INPUT);
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(saveButton(page)).toBeEnabled();
  expect(post.calls()).toBe(0);
});

test('No.9 保存ボタンを素早く2回押しても、登録は1件だけ（押した後は「保存中…」で押せない）', async ({ page }) => {
  await openNewForm(page);
  const post = await mockApi(page, 'POST', '/api/subscriptions', created({}, 1500));
  await fillSubscriptionForm(page, NETFLIX_INPUT);

  // 画面の反映を待たずに2回押す
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('main button')).find((b) => b.textContent === '保存する') as HTMLButtonElement;
    button.click();
    button.click();
  });
  await expect(page.getByRole('main').getByRole('button', { name: '保存中…' })).toBeDisabled();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${CREATED_ID}$`));
  expect(post.calls()).toBe(1);
});

test('No.9 保存ボタンをダブルクリックしても、登録は1件だけ', async ({ page }) => {
  await openNewForm(page);
  const post = await mockApi(page, 'POST', '/api/subscriptions', created({}, 1000));
  await fillSubscriptionForm(page, NETFLIX_INPUT);

  await saveButton(page).dblclick();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${CREATED_ID}$`));
  expect(post.calls()).toBe(1);
});

const DUPLICATE: MockReply = {
  status: 409,
  error: {
    code: 'DUPLICATE_CANDIDATE',
    message: '『netflix』はすでに登録されています。別の契約として登録しますか？',
    candidates: [{ subscriptionId: 'testSubscription0001', serviceName: 'Netflix' }],
  },
};

test('No.11 同名（「netflix」）のときは警告ダイアログを出し、［登録する］で confirmDuplicate を付けて送り直して登録できる', async ({ page }) => {
  await openNewForm(page);
  const post = await mockApi(page, 'POST', '/api/subscriptions', [DUPLICATE, created({ serviceName: 'netflix' })]);
  await fillSubscriptionForm(page, { ...NETFLIX_INPUT, serviceName: 'netflix' });
  await saveButton(page).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '『netflix』はすでに登録されています。' })).toBeVisible();
  await expect(dialog).toContainText('別の契約として登録しますか？');
  await expect(dialog.getByRole('button', { name: '戻る' })).toBeVisible();

  await dialog.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${CREATED_ID}$`));
  expect(post.calls()).toBe(2);
  const [first, second] = post.bodies() as Record<string, unknown>[];
  expect(first).not.toHaveProperty('confirmDuplicate'); // ふだんはキーごと送らない
  expect(second).toEqual({ ...first, confirmDuplicate: true });
});

test('No.11 末尾に空白のある「Netflix 」も、前後の空白を除いた名前で警告し、［戻る］では送らずに入力へ戻る', async ({ page }) => {
  await openNewForm(page);
  const post = await mockApi(page, 'POST', '/api/subscriptions', {
    status: 409,
    error: { ...(DUPLICATE as { error: { code: string; message: string } }).error, message: '『Netflix』はすでに登録されています。別の契約として登録しますか？' },
  });
  await fillSubscriptionForm(page, { ...NETFLIX_INPUT, serviceName: 'Netflix ' });
  await saveButton(page).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '『Netflix』はすでに登録されています。' })).toBeVisible();
  await dialog.getByRole('button', { name: '戻る' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/subscriptions\/new$/);
  await expect(page.getByRole('main').getByRole('textbox', { name: 'サービス名', exact: true })).toHaveValue('Netflix ');
  await expect(saveButton(page)).toBeEnabled();
  expect(post.calls()).toBe(1);
  expect((post.bodies()[0] as Record<string, unknown>).serviceName).toBe('Netflix');
});

test('No.41 S-05（新規）：保存の通信に失敗すると「保存できませんでした。もう一度お試しください」を出し、入力内容は残り、もう一度押せる', async ({ page }) => {
  await openNewForm(page);
  const post = await mockApi(page, 'POST', '/api/subscriptions', ['failure', created()]);
  await fillSubscriptionForm(page, NETFLIX_INPUT);
  await saveButton(page).click();

  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toHaveText('保存できませんでした。もう一度お試しください');
  await expect(main.getByRole('textbox', { name: 'サービス名', exact: true })).toHaveValue('Netflix');
  await expect(main.getByRole('textbox', { name: '1回の請求額（円）', exact: true })).toHaveValue('1590');
  await expect(page).toHaveURL(/\/subscriptions\/new$/);

  await saveButton(page).click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/${CREATED_ID}$`));
  expect(post.calls()).toBe(2);
});

test('No.41 S-05（新規）：オフライン・一時的な障害は共通の文を優先し、409 CONFLICT は API の message ではなく「保存できませんでした…」', async ({ page }) => {
  await openNewForm(page);
  await mockApi(page, 'POST', '/api/subscriptions', [
    { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
    { status: 409, error: { code: 'CONFLICT', message: '競合しました。もう一度お試しください' } },
    'failure', // オフラインのときは通信が届かない
  ]);
  await fillSubscriptionForm(page, NETFLIX_INPUT);
  const alert = page.getByRole('main').getByRole('alert');

  await saveButton(page).click();
  await expect(alert).toHaveText('一時的に利用できません。時間をおいて再試行してください');
  await saveButton(page).click();
  await expect(alert).toHaveText('保存できませんでした。もう一度お試しください');

  await page.context().setOffline(true);
  await saveButton(page).click();
  await expect(alert).toHaveText('オフラインです。接続を確認してください');
  await page.context().setOffline(false);
});

test('No.65 トライアルがオンで最終無料日が空だと、保存せずに最終無料日の欄の下に「最終無料日を入力してください」を出す', async ({ page }) => {
  await openNewForm(page);
  const post = await mockApi(page, 'POST', '/api/subscriptions', created());
  await fillSubscriptionForm(page, { ...NETFLIX_INPUT, serviceName: 'ChatGPT', price: '3000', firstBillingDate: '2026-11-30', category: 'ai' });
  const main = page.getByRole('main');

  await main.getByRole('switch', { name: 'OFF（トライアル中の場合はON）' }).click();
  await expect(main.getByRole('switch', { name: 'ON（トライアル中）' })).toHaveAttribute('aria-checked', 'true');
  const trialEnd = main.getByRole('textbox', { name: 'トライアル最終無料日（ONの場合は必須）', exact: true });
  await expect(trialEnd).toHaveValue('');

  await saveButton(page).click();
  await expect(trialEnd).toHaveAccessibleDescription('最終無料日を入力してください');
  expect(post.calls()).toBe(0);
});

test('送る本文：任意の空の項目は null、トライアルが OFF なら trialEndDate は null、confirmDuplicate は無い。保存の後は S-05 を S-06 に置き換える', async ({
  page,
}) => {
  await openNewForm(page);
  await page.goto('/subscriptions'); // S-04 から開いた形にする
  await page.goto('/subscriptions/new');
  await waitForHydration(page, 'form');
  const post = await mockApi(page, 'POST', '/api/subscriptions', created());
  await fillSubscriptionForm(page, { ...NETFLIX_INPUT, planName: '' });
  // ⑧ 次回請求日は画面で計算した参考表示（今日によって日付が変わるので、形だけを見る）
  await expect(page.getByTestId('next-billing-preview')).toHaveText(/^\d{2}\/\d{2}（¥1,590）$/);
  await saveButton(page).click();

  await expect(page).toHaveURL(new RegExp(`/subscriptions/${CREATED_ID}$`));
  expect(post.bodies()).toEqual([
    {
      serviceName: 'Netflix',
      planName: null,
      price: 1590,
      billingCycle: 'monthly',
      firstBillingDate: '2026-10-08',
      billingDayMode: 'fixedDay',
      category: 'video',
      trialEnabled: false,
      trialEndDate: null,
      websiteUrl: null,
      cancelUrl: null,
      paymentMethod: null,
      memo: null,
      subscriptionNotificationEnabled: true,
    },
  ]);
  // S-06 でブラウザの［戻る］を押しても、入力済みの S-05 に戻らない
  await page.goBack();
  await expect(page).toHaveURL(/\/subscriptions$/);
});

test('保存の 409 SUBSCRIPTION_LIMIT_REACHED と 400 の項目のエラー（欄の下に出し、その欄を直すと消える）', async ({ page }) => {
  await openNewForm(page);
  await mockApi(page, 'POST', '/api/subscriptions', [
    { status: 409, error: { code: 'SUBSCRIPTION_LIMIT_REACHED', message: '登録できるサブスクは200件までです' } },
    {
      status: 400,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'http:// か https:// から始まるURLを入力してください',
        field: 'websiteUrl',
        details: [{ field: 'websiteUrl', code: 'VALIDATION_ERROR', message: 'http:// か https:// から始まるURLを入力してください' }],
      },
    },
    { status: 400, error: { code: 'UNKNOWN_FIELD', message: '不明な項目が含まれています', field: 'nextBillingDate' } },
  ]);
  await fillSubscriptionForm(page, { ...NETFLIX_INPUT, websiteUrl: 'https://www.netflix.com' });
  const main = page.getByRole('main');

  await saveButton(page).click();
  await expect(main.getByRole('alert')).toHaveText('登録できるサブスクは200件までです');

  await saveButton(page).click();
  const website = main.getByRole('textbox', { name: '公式サイトURL（任意）', exact: true });
  await expect(website).toHaveAccessibleDescription('http:// か https:// から始まるURLを入力してください');
  await expect(saveButton(page)).toBeDisabled();
  await website.fill('https://www.netflix.com/jp');
  await expect(website).toHaveAccessibleDescription('');
  await expect(saveButton(page)).toBeEnabled();

  await saveButton(page).click();
  await expect(main.getByRole('alert')).toHaveText('保存できませんでした。もう一度お試しください');
});

test('⑦ 請求日が月末日のときだけ「毎月末日」を選べ、月末日でなくなると「請求日と同じ日」に戻る', async ({ page }) => {
  await openNewForm(page);
  const main = page.getByRole('main');
  await expect(main.getByRole('radio', { name: '毎月末日（選択不可）' })).toBeDisabled();
  await expect(main.getByText('※ 月末日以外の請求日は「毎月末日」を選択できません')).toBeVisible();

  await fillSubscriptionForm(page, { firstBillingDate: '2026-11-30', billingCycle: 'monthly', price: '3000' });
  await main.getByRole('radio', { name: '毎月末日', exact: true }).check();
  await expect(main.getByRole('radio', { name: '毎月末日', exact: true })).toBeChecked();

  await fillSubscriptionForm(page, { firstBillingDate: '2026-11-29' });
  await expect(main.getByRole('radio', { name: '請求日と同じ日' })).toBeChecked();
  await expect(main.getByRole('radio', { name: '毎月末日（選択不可）' })).toBeDisabled();
});

test('［キャンセル］で前の画面へ戻る。新規の下の案内2文を出す。幅375pxで横スクロールなし・押せる大きさ44px以上', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openNewForm(page);
  const main = page.getByRole('main');
  await expect(main.getByText('入力内容を確認して保存します。')).toBeVisible();
  await expect(main.getByText('同じサービス名で登録済みの場合は、保存前に確認ダイアログを表示します。')).toBeVisible();
  await expect(main.getByText('登録上限は200件です。')).toBeVisible();
  await main.getByRole('switch', { name: 'OFF（トライアル中の場合はON）' }).click();
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page);

  await main.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page).not.toHaveURL(/\/subscriptions\/new$/);
});
