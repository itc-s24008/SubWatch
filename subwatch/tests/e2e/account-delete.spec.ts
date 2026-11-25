// S-09 ⑩ アカウント削除の画面テスト（04-17。詳細_F-07、画面設計書 S-09 ⑩・状態・ダイアログ一覧、決まりの一覧 C-6・C-9・C-14）
// テスト一覧の No.36（画面から削除して S-02 に完了の文）・No.38（失敗したとき成功と表示しない、本人確認の失敗、401 REAUTH_REQUIRED、
// あわせて：押した時点のオフライン、削除の応答が届かない〔通信の失敗と30秒の時間切れ〕の決まりの分岐）
// 画面のテストは仮データを使わない。Emulator でログインし、失敗の場面は mockApi で作る（S-13 の入口〔trigger="link"〕の画面テストは 04-19）
// ②の本人確認は Google のポップアップ（決まりの一覧 C-19）。Auth Emulator のポップアップでアカウントを選ぶ
import { expect, test, type Page } from '@playwright/test';
import { adminAuth, adminDb } from '../../lib/firebase-admin';
import { chooseGoogleAccount, createUser, expectNoHorizontalScroll, expectTapTargets, loginAsNewUser, mockApi } from './helpers';

const DONE = 'アカウントを削除しました。ご利用ありがとうございました';
const FAILED = '削除できませんでした。もう一度お試しください';
const NO_RESPONSE =
  '削除が完了したか確認できませんでした。もう一度ログインしてください（ログインして利用規約への同意を求められたら、削除は完了しています）';
const REAUTH_TEXT = '本人確認のため、［削除する］を押して、もう一度 Google でログインしてください。ログイン中と同じアカウントを選んでください';

// S-09 を開き、サーバーを呼ばない後始末（04-12 が Push 購読の解除を登録する所）に数える処理を登録する
async function openSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { cleanupCalls: number };
    w.cleanupCalls = 0;
    window.__SUBWATCH_E2E__!.registerLocalCleanup(() => {
      w.cleanupCalls += 1;
    });
  });
}

async function cleanupCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { cleanupCalls: number }).cleanupCalls);
}

// Firebase への再認証（Google でのサインイン）の要求と、Push の購読解除の API の数を数える
function countRequests(page: Page): { reauth: () => number; pushUnsubscribe: () => number } {
  let reauth = 0;
  let pushUnsubscribe = 0;
  page.on('request', (request) => {
    if (request.url().includes('accounts:signInWithIdp')) reauth += 1;
    if (new URL(request.url()).pathname === '/api/push/subscribe') pushUnsubscribe += 1;
  });
  return { reauth: () => reauth, pushUnsubscribe: () => pushUnsubscribe };
}

function deleteButton(page: Page) {
  return page.getByRole('button', { name: 'アカウントを削除', exact: true });
}
function confirmDialog(page: Page) {
  return page.getByRole('dialog', { name: 'アカウントを削除しますか？' });
}
function reauthDialog(page: Page) {
  return page.getByRole('dialog', { name: '本人確認' });
}

// ①で DELETE を入れて［次へ］を押し、②を開く
async function openReauthStep(page: Page, typed = 'DELETE') {
  await deleteButton(page).click();
  await confirmDialog(page).getByRole('textbox').fill(typed);
  await confirmDialog(page).getByRole('button', { name: '次へ' }).click();
  await expect(reauthDialog(page)).toBeVisible();
  return reauthDialog(page);
}

// ②の［削除する］を押し、開いた Google のポップアップでアカウントを選ぶ
async function reauthAndDelete(page: Page, email: string): Promise<void> {
  const popupPromise = page.waitForEvent('popup');
  await reauthDialog(page).getByRole('button', { name: '削除する' }).click();
  await chooseGoogleAccount(await popupPromise, email);
}

async function expectStillLoggedInOnSettings(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  await expect(page.getByText(DONE)).toHaveCount(0);
}

test.describe('S-09 ⑩ アカウント削除', () => {
  test('No.36 DELETE と入力し（前後の空白は除く）、Google で本人確認して削除すると、データと Auth が消え、S-02 に「アカウントを削除しました…」が出る', async ({ page }) => {
    const user = await loginAsNewUser(page);
    await adminDb().collection('users').doc(user.uid).collection('subscriptions').doc('e2eSubscription00001').set({ serviceName: 'Netflix' });
    await openSettings(page);
    const requests = countRequests(page);

    await deleteButton(page).click();
    const confirm = confirmDialog(page);
    await expect(confirm.getByText('登録したサブスクと通知の履歴がすべて消えます。')).toBeVisible();
    await expect(confirm.getByText('この操作は取り消せません。')).toBeVisible();
    const input = confirm.getByRole('textbox', { name: '確認のため『DELETE』と入力してください' });
    await expect(input).toHaveAttribute('placeholder', 'DELETE と入力');
    const next = confirm.getByRole('button', { name: '次へ' });
    await expect(next).toBeDisabled();
    await input.fill('delete');
    await expect(next).toBeDisabled();
    await input.fill('  DELETE  ');
    await expect(next).toBeEnabled();
    await next.click();

    await expect(reauthDialog(page).getByText(REAUTH_TEXT)).toBeVisible();
    const sent = page.waitForRequest((request) => request.method() === 'DELETE' && new URL(request.url()).pathname === '/api/account');
    await reauthAndDelete(page, user.email);
    expect((await sent).postDataJSON()).toEqual({ confirmation: 'DELETE' }); // 入力値ではなく決まった文字列

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: DONE })).toBeVisible();
    expect(await cleanupCalls(page)).toBe(1);
    expect(requests.reauth()).toBe(1);
    expect(requests.pushUnsubscribe()).toBe(0); // logout() は使わない（サーバーの購読解除を呼ばない）

    // サーバーのデータと Auth が消えている
    expect((await adminDb().collection('users').doc(user.uid).get()).exists).toBe(false);
    expect((await adminDb().collection('users').doc(user.uid).collection('subscriptions').get()).size).toBe(0);
    await expect(adminAuth().getUser(user.uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });

    // サインアウトしている
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('No.38 削除に失敗（500 DELETE_FAILED）すると、ダイアログを閉じて［アカウントを削除］のすぐ下に「削除できませんでした…」（成功と表示しない）。もう一度押すと①から始まり、完了する', async ({ page }) => {
    const user = await loginAsNewUser(page);
    await openSettings(page);
    const del = await mockApi(page, 'DELETE', '/api/account', [
      { status: 500, error: { code: 'DELETE_FAILED', message: FAILED } },
      { data: { status: 'deleted' } },
    ]);

    const dialog = await openReauthStep(page);
    await reauthAndDelete(page, user.email);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    const message = deleteButton(page).locator('xpath=following-sibling::p[1]');
    await expect(message).toHaveText(FAILED);
    await expect(message).toHaveAttribute('role', 'alert');
    await expectStillLoggedInOnSettings(page);
    expect(await cleanupCalls(page)).toBe(0);
    expect(del.calls()).toBe(1);

    // もう一度押すと①から（入力は空、［次へ］は押せない）
    await deleteButton(page).click();
    await expect(confirmDialog(page).getByRole('textbox')).toHaveValue('');
    await expect(confirmDialog(page).getByRole('button', { name: '次へ' })).toBeDisabled();
    await expect(page.getByText(FAILED)).toHaveCount(0);
    await confirmDialog(page).getByRole('textbox').fill('DELETE');
    await confirmDialog(page).getByRole('button', { name: '次へ' }).click();
    await reauthAndDelete(page, user.email);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: DONE })).toBeVisible();
    expect(del.calls()).toBe(2);
    expect(del.bodies()).toEqual([{ confirmation: 'DELETE' }, { confirmation: 'DELETE' }]);
  });

  test('No.38 503 TEMPORARILY_UNAVAILABLE でも、サインアウトせず「削除できませんでした…」（共通の文は出さない）', async ({ page }) => {
    const user = await loginAsNewUser(page);
    await openSettings(page);
    await mockApi(page, 'DELETE', '/api/account', {
      status: 503,
      error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' },
    });
    const dialog = await openReauthStep(page);
    await reauthAndDelete(page, user.email);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: FAILED })).toBeVisible();
    await expect(page.getByText('一時的に利用できません。時間をおいて再試行してください')).toHaveCount(0);
    await expectStillLoggedInOnSettings(page);
  });

  test('No.38 ポップアップを閉じたら文を出さず、違う Google アカウントを選んだら「ログイン中と同じ Google アカウントを選んでください」（どちらもダイアログを開いたまま。DELETE は呼ばない）', async ({ page }) => {
    await loginAsNewUser(page);
    const other = await createUser();
    await openSettings(page);
    const del = await mockApi(page, 'DELETE', '/api/account', { data: { status: 'deleted' } });
    const dialog = await openReauthStep(page);

    // ポップアップを閉じる
    let popupPromise = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: '削除する' }).click();
    await (await popupPromise).close();
    await expect(dialog.getByRole('button', { name: '削除する' })).toBeEnabled();
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // 違うアカウントを選ぶ
    popupPromise = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: '削除する' }).click();
    await chooseGoogleAccount(await popupPromise, other.email);
    await expect(dialog.getByRole('alert')).toHaveText('ログイン中と同じ Google アカウントを選んでください');
    await expect(dialog.getByRole('button', { name: '削除する' })).toBeEnabled();
    expect(del.calls()).toBe(0);
    await expectStillLoggedInOnSettings(page);
  });

  test('No.38 401 REAUTH_REQUIRED なら、ダイアログの中に「もう一度 Google で本人確認してください」と出し、もう一度押せる', async ({ page }) => {
    const user = await loginAsNewUser(page);
    await openSettings(page);
    const del = await mockApi(page, 'DELETE', '/api/account', {
      status: 401,
      error: { code: 'REAUTH_REQUIRED', message: 'もう一度 Google で本人確認してください' },
    });
    const dialog = await openReauthStep(page);
    await reauthAndDelete(page, user.email);

    await expect(dialog.getByRole('alert')).toHaveText('もう一度 Google で本人確認してください');
    await expect(dialog.getByRole('button', { name: '削除する' })).toBeEnabled();
    expect(del.calls()).toBe(1);
    await expectStillLoggedInOnSettings(page);
  });

  test('No.38 ［削除する］を押した時点でオフラインなら、再認証も DELETE もせず、ダイアログの中に「オフラインです…」（サインアウトしない・開いたまま）', async ({ page, context }) => {
    await loginAsNewUser(page);
    await openSettings(page);
    const del = await mockApi(page, 'DELETE', '/api/account', { data: { status: 'deleted' } });
    const requests = countRequests(page);
    const dialog = await openReauthStep(page);

    await context.setOffline(true);
    await dialog.getByRole('button', { name: '削除する' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('オフラインです。接続を確認してください'); // ポップアップは開かない
    await expect(reauthDialog(page)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '削除する' })).toBeEnabled(); // もう一度押せる
    expect(requests.reauth()).toBe(0);
    expect(del.calls()).toBe(0);
    expect(await cleanupCalls(page)).toBe(0);
    await context.setOffline(false);
    await expectStillLoggedInOnSettings(page);
  });

  test('No.38 削除の応答が届かない（通信の失敗）ときは、この端末の Push 購読を解除し（サーバーは呼ばない）、サインアウトして S-02 に「削除が完了したか確認できませんでした…」', async ({ page }) => {
    const user = await loginAsNewUser(page);
    await openSettings(page);
    const del = await mockApi(page, 'DELETE', '/api/account', 'failure');
    const requests = countRequests(page);
    const dialog = await openReauthStep(page);
    await reauthAndDelete(page, user.email);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: NO_RESPONSE })).toBeVisible();
    await expect(page.getByText(DONE)).toHaveCount(0);
    expect(await cleanupCalls(page)).toBe(1);
    expect(requests.pushUnsubscribe()).toBe(0);
    expect(del.calls()).toBe(1);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/); // サインアウトしている
  });

  test('No.38 削除の応答が届かない（30秒の時間切れ）ときも、Push 購読を解除し、サインアウトして S-02 に「削除が完了したか確認できませんでした…」', async ({ page }) => {
    await page.clock.install(); // ページを開く前に入れる（決まりの一覧 C-9）
    const user = await loginAsNewUser(page);
    await openSettings(page);
    const del = await mockApi(page, 'DELETE', '/api/account', 'noResponse');
    const requests = countRequests(page);
    const dialog = await openReauthStep(page);
    await reauthAndDelete(page, user.email);

    // DELETE が届いてから時計を進める（届く前だと api() のタイマーがまだ無い）
    await expect.poll(() => del.calls()).toBe(1);
    // 削除中は「削除中…」で、［キャンセル］も押せず、Esc でも閉じない
    await expect(dialog.getByRole('button', { name: '削除中…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(reauthDialog(page)).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);

    await page.clock.runFor(30_000);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: NO_RESPONSE })).toBeVisible();
    expect(await cleanupCalls(page)).toBe(1);
    expect(requests.pushUnsubscribe()).toBe(0);
  });

  test('①は［キャンセル］で閉じ、DELETE を呼ばない。ダイアログを開いても幅375pxで横スクロールなし・押せる大きさ44px以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsNewUser(page);
    await openSettings(page);
    const del = await mockApi(page, 'DELETE', '/api/account', { data: { status: 'deleted' } });
    await expectTapTargets(page);
    await deleteButton(page).click();
    await expect(confirmDialog(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await confirmDialog(page).getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await openReauthStep(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await reauthDialog(page).getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(del.calls()).toBe(0);
    await expectStillLoggedInOnSettings(page);
  });
});
