// S-05 編集画面・S-06 の最小表示・削除の確認ダイアログの画面テスト（04-08）
// 期待値は機能設計書「テスト一覧」No.41（S-06 の読み込み失敗）、画面設計書 S-05 ⑰⑱・S-06 ②⑨⑩⑪・状態・ダイアログ一覧 S-05・S-06 の行
// API は mockApi で作る（仮データ〔NEXT_PUBLIC_USE_MOCKS〕は使わない。04-07 の API が入った後も同じテストが動くように）
// 画面の文字は、後で表示が増えても壊れないように、カード（section）・見出し・ダイアログの中に絞って探す
import { expect, test, type Page } from '@playwright/test';
import { accountResponse, expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi, subscriptionDto, waitForHydration } from './helpers';

const ID = 'testSubscription0001';
const DETAIL = `/subscriptions/${ID}`;
const EDIT = `/subscriptions/${ID}/edit`;
const NETFLIX = subscriptionDto({ subscriptionId: ID });

// ログインする。Gates（04-05）が読む GET /api/account と、S-04（04-09）が読む GET /api/subscriptions は、正常な応答を置く
async function login(page: Page) {
  const user = await loginAsNewUser(page);
  await mockApi(page, 'GET', '/api/account', accountResponse(user.email));
  await mockApi(page, 'GET', '/api/subscriptions', { data: { items: [NETFLIX], totalCount: 1 } });
  return user;
}

// S-06 の②のカード（サービス名の見出しを含む section）
function detailCard(page: Page) {
  return page.getByRole('main').locator('section').filter({ has: page.getByRole('heading', { level: 2 }) });
}

function form(page: Page) {
  return page.getByRole('main');
}

async function openEdit(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを編集' })).toBeVisible();
  await waitForHydration(page, 'form');
}

test('No.41 S-06：読み込みに失敗すると「読み込めませんでした」「もう一度お試しください」と［再試行］を出し、［再試行］で表示する', async ({ page }) => {
  await login(page);
  const get = await mockApi(page, 'GET', '/api/subscriptions/:id', ['failure', { data: { subscription: NETFLIX } }]);
  await page.goto(DETAIL);

  await expect(page.getByRole('heading', { level: 1, name: 'サービス詳細' })).toBeVisible();
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('読み込めませんでした');
  await expect(alert).toContainText('もう一度お試しください');
  await alert.getByRole('button', { name: '再試行' }).click();

  await expect(detailCard(page).getByRole('heading', { level: 2, name: 'Netflix' })).toBeVisible();
  await expect(detailCard(page)).toContainText('動画・スタンダード');
  await expect(detailCard(page)).toContainText('次回請求予定');
  await expect(detailCard(page)).toContainText('11/08・¥1,590');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(get.calls()).toBe(2);
});

test('S-06：⑨編集する・⑩削除する・⑪注意書きを出す。幅375pxで横スクロールなし・押せる大きさ44px以上', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: subscriptionDto({ subscriptionId: ID, planName: null }) } });
  await page.goto(DETAIL);

  const main = page.getByRole('main');
  await expect(detailCard(page).getByRole('heading', { level: 2, name: 'Netflix' })).toBeVisible();
  await expect(detailCard(page).getByText('動画', { exact: true })).toBeVisible(); // プラン名が未入力ならカテゴリーだけ
  await expect(main.getByRole('link', { name: '編集する' })).toHaveAttribute('href', EDIT);
  await expect(main.getByRole('button', { name: '削除する' })).toBeVisible();
  await expect(main.getByText('解約したら、このサブスクを削除してください。')).toBeVisible();
  await expect(main.getByText('削除時は確認ダイアログを表示します。届いた通知の履歴は残ります')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page);
});

test('S-06・S-05（編集）：開くときの 404 は「見つかりません」と［一覧へ戻る］（編集でも題と「戻る」を出す）', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { status: 404, error: { code: 'NOT_FOUND', message: 'サブスクが見つかりません' } });

  await page.goto(DETAIL);
  const main = page.getByRole('main');
  await expect(main.getByText('見つかりません', { exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: '一覧へ戻る' })).toHaveAttribute('href', '/subscriptions');

  await page.goto(EDIT);
  await expect(page.getByRole('heading', { level: 1, name: 'サブスクを編集' })).toBeVisible();
  await expect(page.getByRole('button', { name: '戻る' })).toBeVisible();
  await expect(main.getByText('見つかりません', { exact: true })).toBeVisible();
  await main.getByRole('link', { name: '一覧へ戻る' }).click();
  await expect(page).toHaveURL(/\/subscriptions$/);
});

test('編集して保存すると、PATCH の本文は変更した項目だけ（confirmDuplicate は無い）。URL を直接開いたときは S-05 を S-06 に置き換える', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  const patch = await mockApi(page, 'PATCH', '/api/subscriptions/:id', {
    data: { subscription: subscriptionDto({ subscriptionId: ID, price: 1890, memo: '家族で分担' }) },
  });
  await page.goto(EDIT);
  await openEdit(page);

  // 登録済みの値が入っている。下の案内2文は、編集では出さない
  await expect(form(page).getByRole('textbox', { name: 'サービス名', exact: true })).toHaveValue('Netflix');
  await expect(form(page).getByRole('textbox', { name: '1回の請求額（円）', exact: true })).toHaveValue('1590');
  await expect(form(page).getByRole('combobox', { name: '請求周期', exact: true })).toHaveValue('monthly');
  await expect(form(page).getByText('入力内容を確認して保存します。')).toBeVisible();
  await expect(form(page).getByText('同じサービス名で登録済みの場合は、保存前に確認ダイアログを表示します。')).toHaveCount(0);
  await expect(form(page).getByText('登録上限は200件です。')).toHaveCount(0);

  await form(page).getByRole('textbox', { name: '1回の請求額（円）', exact: true }).fill('1890');
  await form(page).getByRole('textbox', { name: 'メモ（任意・最大1000文字）', exact: true }).fill('家族で分担');
  await form(page).getByRole('button', { name: '保存する' }).click();

  await expect(page).toHaveURL(new RegExp(`${DETAIL}$`));
  expect(patch.bodies()).toEqual([{ price: 1890, memo: '家族で分担' }]);
  // 履歴の1つ前が S-06 ではない（/terms から URL を直接開いた）ので置き換えた：［戻る］で S-05 に戻らない
  await expect(detailCard(page).getByRole('heading', { level: 2, name: 'Netflix' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/terms$/);
});

test('変更がなければ PATCH を呼ばずに S-06 へ戻る（履歴を1つ戻る）', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  const patch = await mockApi(page, 'PATCH', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  await page.goto('/subscriptions');
  await page.goto(DETAIL);
  await page.getByRole('main').getByRole('link', { name: '編集する' }).click();
  await openEdit(page);

  await form(page).getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(new RegExp(`${DETAIL}$`));
  await expect(detailCard(page).getByRole('heading', { level: 2, name: 'Netflix' })).toBeVisible();
  expect(patch.calls()).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/subscriptions$/);
});

test('S-06 から編集して保存すると、S-06 に戻って保存した後の値が出て、［戻る］を1回押すと S-06 の前の画面に戻る（S-06 が2つ並ばない）', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  const patch = await mockApi(page, 'PATCH', '/api/subscriptions/:id', {
    data: { subscription: subscriptionDto({ subscriptionId: ID, price: 1890, planName: 'プレミアム' }) },
  });
  await page.goto('/subscriptions'); // S-04
  await page.goto(DETAIL); // S-06
  await expect(detailCard(page)).toContainText('11/08・¥1,590');
  await page.getByRole('main').getByRole('link', { name: '編集する' }).click();
  await openEdit(page);

  // 保存の後に S-06 が読む値（サーバーに保存された後の値）
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: subscriptionDto({ subscriptionId: ID, price: 1890, planName: 'プレミアム' }) } });
  await form(page).getByRole('textbox', { name: 'プラン名', exact: true }).fill('プレミアム');
  await form(page).getByRole('textbox', { name: '1回の請求額（円）', exact: true }).fill('1890');
  await form(page).getByRole('button', { name: '保存する' }).click();

  await expect(page).toHaveURL(new RegExp(`${DETAIL}$`));
  await expect(detailCard(page)).toContainText('動画・プレミアム');
  await expect(detailCard(page)).toContainText('11/08・¥1,890');
  expect(patch.bodies()).toEqual([{ planName: 'プレミアム', price: 1890 }]);

  await page.goBack();
  await expect(page).toHaveURL(/\/subscriptions$/);
});

test('保存のときの 404 は、入力内容を残したまま［キャンセル］［保存する］のすぐ上に「サブスクが見つかりません」を出す', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  await mockApi(page, 'PATCH', '/api/subscriptions/:id', { status: 404, error: { code: 'NOT_FOUND', message: 'サブスクが見つかりません' } });
  await page.goto(EDIT);
  await openEdit(page);

  await form(page).getByRole('textbox', { name: '1回の請求額（円）', exact: true }).fill('1890');
  await form(page).getByRole('button', { name: '保存する' }).click();

  const alert = form(page).getByRole('alert');
  await expect(alert).toHaveText('サブスクが見つかりません');
  await expect(page).toHaveURL(new RegExp(`${EDIT}$`));
  await expect(form(page).getByRole('textbox', { name: '1回の請求額（円）', exact: true })).toHaveValue('1890');
  // 文は「入力内容を確認して保存します。」の下、ボタンの上
  const alertBox = await alert.boundingBox();
  const guideBox = await form(page).getByText('入力内容を確認して保存します。').boundingBox();
  const saveBox = await form(page).getByRole('button', { name: '保存する' }).boundingBox();
  expect(alertBox!.y).toBeGreaterThan(guideBox!.y);
  expect(alertBox!.y).toBeLessThan(saveBox!.y);
  await expect(page.getByText('見つかりません', { exact: true })).toHaveCount(0); // 開くときの「見つかりません」とは分ける
});

// 「削除しました」は S-04 が takeFlash で出す（04-09）。04-09 が入る前は、flash に置かれたことを見る
async function expectDeletedFlash(page: Page) {
  await expect
    .poll(async () => {
      const flash = await page.evaluate(() => window.sessionStorage.getItem('subwatch.flash'));
      const shown = await page.getByRole('main').getByRole('status').filter({ hasText: '削除しました' }).count();
      return flash === '削除しました' || shown > 0;
    })
    .toBe(true);
}

test('削除の成功：確認ダイアログの［削除する］で DELETE し、S-04 へ置き換える（「削除しました」を置く）', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  const del = await mockApi(page, 'DELETE', '/api/subscriptions/:id', { status: 204, delayMs: 800 });
  await page.goto(DETAIL);
  await expect(detailCard(page).getByRole('heading', { level: 2, name: 'Netflix' })).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: '削除する' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Netflixを削除しますか？' })).toBeVisible();
  await expect(dialog).toContainText('通知の履歴は残ります。');
  await expect(dialog).toContainText('この操作は取り消せません。');
  await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();

  await dialog.getByRole('button', { name: '削除する' }).click();
  await expect(dialog.getByRole('button', { name: '削除中…' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  await page.keyboard.press('Escape'); // 削除中は Esc でも閉じない
  await expect(dialog).toBeVisible();

  await expect(page).toHaveURL(/\/subscriptions$/);
  expect(del.calls()).toBe(1);
  await expectDeletedFlash(page);
  await page.goBack(); // S-04 で［戻る］を押しても、削除した S-06 に戻らない
  await expect(page).toHaveURL(/\/terms$/);
});

test('削除の 404（すでに削除されていた）も「削除しました」として S-04 へ移る', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  await mockApi(page, 'DELETE', '/api/subscriptions/:id', { status: 404, error: { code: 'NOT_FOUND', message: 'サブスクが見つかりません' } });
  await page.goto(DETAIL);
  await page.getByRole('main').getByRole('button', { name: '削除する' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
  await expect(page).toHaveURL(/\/subscriptions$/);
  await expectDeletedFlash(page);
});

test('削除の失敗：ダイアログの中に「削除できませんでした。もう一度お試しください」を出し、もう一度押せる。［キャンセル］で閉じる', async ({ page }) => {
  await login(page);
  await mockApi(page, 'GET', '/api/subscriptions/:id', { data: { subscription: NETFLIX } });
  const del = await mockApi(page, 'DELETE', '/api/subscriptions/:id', [
    'failure',
    { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
  ]);
  await page.goto(DETAIL);
  await page.getByRole('main').getByRole('button', { name: '削除する' }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: '削除する' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('削除できませんでした。もう一度お試しください');
  await expect(page).toHaveURL(new RegExp(`${DETAIL}$`));

  await dialog.getByRole('button', { name: '削除する' }).click(); // もう一度押せる
  await expect(dialog.getByRole('alert')).toHaveText('一時的に利用できません。時間をおいて再試行してください');
  expect(del.calls()).toBe(2);

  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(detailCard(page).getByRole('heading', { level: 2, name: 'Netflix' })).toBeVisible();
});
