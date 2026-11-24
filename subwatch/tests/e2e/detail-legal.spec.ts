// S-06 の完成（解約案内ほか）・S-11 利用規約・S-12 プライバシーポリシー・S-09 ⑪・S-13 同意の確認の画面テスト（04-19）
// テスト一覧 No.59（解約案内）と No.36 の画面の部分（S-13 で⑥の処理中は⑦⑧が押せない。テスト一覧 E39）
// 期待値は画面設計書 S-06・S-09 ⑪・S-11・S-12・S-13・状態・ダイアログ一覧、機能設計書 詳細_F-01・F-03・F-07・API共通仕様 B107〜B109、決まりの一覧 C-4・C-5・C-14・D-5
// 画面のテストは仮データを使わない。Emulator でログインし、S-06 の詳細の応答と失敗の場面は mockApi で作る。
// 解約案内は今日で変わるので、ログインの前に page.clock.setFixedTime で今日を決め、nextBillingDate・trialEndDate は mockApi の応答で決める
import { expect, test, type Page } from '@playwright/test';
import { adminDb } from '../../lib/firebase-admin';
import {
  accountResponse,
  expectNoHorizontalScroll,
  expectTapTargets,
  loginAsNewUser,
  mockApi,
  subscriptionDto,
  waitForHydration,
} from './helpers';

const ID = 'testSubscription0001';
const DETAIL = `/subscriptions/${ID}`;
const TODAY = '2026-11-04T10:00:00+09:00'; // 基準日（日本時間）
const OLD_VERSION = '2000-01-01';
const GUIDE_TITLE = '解約を検討するタイミングです';
const NOT_REGISTERED = '未登録：編集で追加できます';
const PUBLICATION_SCOPE = '公開範囲：授業関係者とデモのみ。2026年12月24日に公開を停止し、登録データを削除します';
const CONTACT = '問い合わせ先：Eチーム（卒業制作のため、個別の連絡窓口は設けていません）';
const DISCLAIMER = 'この文書は卒業制作のために作成したもので、法律の専門家による確認は受けていません';

// ---- S-06 ----

// 今日を決めてからログインし、Gates の GET /api/account と S-06 の GET /api/subscriptions/:id を mockApi で置く
async function openDetail(page: Page, subscription: ReturnType<typeof subscriptionDto> | ReturnType<typeof subscriptionDto>[], url = DETAIL) {
  await page.clock.setFixedTime(new Date(TODAY));
  const user = await loginAsNewUser(page);
  await mockApi(page, 'GET', '/api/account', accountResponse(user.email));
  const list = Array.isArray(subscription) ? subscription : [subscription];
  const get = await mockApi(
    page,
    'GET',
    '/api/subscriptions/:id',
    list.map((item) => ({ data: { subscription: item } })),
  );
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'サービス詳細' })).toBeVisible();
  return get;
}

// ①の解約案内のカード（見出しを含む枠）
function guideCard(page: Page) {
  return page.getByRole('main').getByRole('heading', { level: 2, name: GUIDE_TITLE }).locator('..');
}

// ⑤〜⑧の行（題〔h3〕を含む枠）
function infoRow(page: Page, title: string) {
  return page.getByRole('main').getByRole('heading', { level: 3, name: title, exact: true }).locator('..');
}

async function waitForDetail(page: Page, serviceName = 'Netflix') {
  await expect(page.getByRole('main').getByRole('heading', { level: 2, name: serviceName })).toBeVisible();
}

test.describe('S-06 ①解約案内', () => {
  test('No.59 次回請求日まで7日以内なら案内を出す。解約URLが無ければ「未登録：編集で追加できます」、あれば［解約ページを開く］（新しいタブ）', async ({ page }) => {
    await openDetail(page, [
      subscriptionDto({ subscriptionId: ID, nextBillingDate: '2026-11-11', price: 1590, cancelUrl: null }),
      subscriptionDto({ subscriptionId: ID, nextBillingDate: '2026-11-11', price: 1590, cancelUrl: 'https://www.netflix.com/cancelplan' }),
    ]);
    await waitForDetail(page);
    const guide = guideCard(page);
    await expect(guide).toContainText('11/11 に ¥1,590 の請求予定です。');
    await expect(guide).toContainText('使っていなければ、請求日の前に解約を検討しましょう。');
    await expect(guide.getByText(NOT_REGISTERED)).toBeVisible();
    await expect(guide.getByRole('link', { name: '解約ページを開く' })).toHaveCount(0);
    // ①は②のカードの上
    const guideBox = await guide.boundingBox();
    const cardBox = await page.getByRole('main').locator('section').boundingBox();
    expect(guideBox!.y).toBeLessThan(cardBox!.y);

    await page.reload();
    await waitForDetail(page);
    const open = guideCard(page).getByRole('link', { name: '解約ページを開く' });
    await expect(open).toHaveAttribute('href', 'https://www.netflix.com/cancelplan');
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(guideCard(page).getByText(NOT_REGISTERED)).toHaveCount(0);
  });

  test('No.59 次回請求日が今日（0日）でも案内を出し、8日以上先なら出さない', async ({ page }) => {
    await openDetail(page, [
      subscriptionDto({ subscriptionId: ID, nextBillingDate: '2026-11-04', price: 0 }),
      subscriptionDto({ subscriptionId: ID, nextBillingDate: '2026-11-12' }),
    ]);
    await waitForDetail(page);
    await expect(guideCard(page)).toContainText('11/04 に ¥0 の請求予定です。');

    await page.reload();
    await waitForDetail(page);
    await expect(page.getByRole('heading', { name: GUIDE_TITLE })).toHaveCount(0);
  });

  test('No.59 無料トライアルで最終無料日まで7日以内なら、請求日が8日以上先でも「MM/DD で無料期間が終わります…」を出す。最終無料日を過ぎたら請求日の条件だけで決める', async ({ page }) => {
    await openDetail(page, [
      subscriptionDto({ subscriptionId: ID, trialEnabled: true, trialEndDate: '2026-11-11', nextBillingDate: '2026-12-11' }),
      subscriptionDto({ subscriptionId: ID, trialEnabled: true, trialEndDate: '2026-11-03', nextBillingDate: '2026-11-06', price: 980 }),
      subscriptionDto({ subscriptionId: ID, trialEnabled: true, trialEndDate: '2026-11-03', nextBillingDate: '2026-11-20' }),
      subscriptionDto({ subscriptionId: ID, trialEnabled: true, trialEndDate: '2026-11-12', nextBillingDate: '2026-11-12' }),
    ]);
    await waitForDetail(page);
    const guide = guideCard(page);
    await expect(guide).toContainText('11/11 で無料期間が終わります。');
    await expect(guide).toContainText('続けないなら、その日までに解約を検討しましょう。');
    await expect(guide).not.toContainText('請求予定です');

    // 最終無料日を過ぎた後：請求日まで2日 → 請求の案内
    await page.reload();
    await waitForDetail(page);
    await expect(guideCard(page)).toContainText('11/06 に ¥980 の請求予定です。');

    // 最終無料日を過ぎた後：請求日が8日以上先 → 案内なし
    await page.reload();
    await waitForDetail(page);
    await expect(page.getByRole('heading', { name: GUIDE_TITLE })).toHaveCount(0);

    // 最終無料日まで8日・請求日まで8日 → 案内なし
    await page.reload();
    await waitForDetail(page);
    await expect(page.getByRole('heading', { name: GUIDE_TITLE })).toHaveCount(0);
  });
});

test.describe('S-06 ②〜⑧', () => {
  test('②支払方法、③月額換算・④年額換算、⑤〜⑧（リンクは新しいタブ、メモは改行も出す）。幅375pxで横スクロールなし・押せる大きさ44px以上', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openDetail(
      page,
      subscriptionDto({
        subscriptionId: ID,
        price: 12000,
        billingCycle: 'yearly',
        nextBillingDate: '2026-12-01',
        trialEnabled: true,
        trialEndDate: '2026-11-30',
        websiteUrl: 'https://www.icloud.com/very/long/path/to/check/that/the/url/wraps/inside/the/card/without/horizontal/scroll',
        cancelUrl: 'https://support.apple.com/cancel',
        paymentMethod: 'メインカード',
        memo: '家族と分担\n  内訳：半分',
      }),
    );
    await waitForDetail(page);
    const main = page.getByRole('main');
    const card = main.locator('section');
    await expect(card).toContainText('動画・スタンダード');
    await expect(card.getByText('支払方法：メインカード')).toBeVisible();
    await expect(card).toContainText('12/01・¥12,000');

    await expect(main.getByText('月額換算', { exact: true }).locator('..')).toContainText('¥1,000');
    await expect(main.getByText('年額換算（参考）', { exact: true }).locator('..')).toContainText('¥12,000');

    await expect(main.getByRole('heading', { level: 2, name: '登録情報' })).toBeVisible();
    await expect(infoRow(page, '無料トライアル')).toContainText('最終無料日：11/30');
    await expect(infoRow(page, '無料トライアル')).toContainText('この日までは無料です');
    const site = infoRow(page, '公式サイト').getByRole('link');
    await expect(site).toHaveAttribute('href', /^https:\/\/www\.icloud\.com\//);
    await expect(site).toHaveAttribute('target', '_blank');
    const cancel = infoRow(page, '解約ページ').getByRole('link', { name: 'https://support.apple.com/cancel' });
    await expect(cancel).toHaveAttribute('target', '_blank');
    const memo = infoRow(page, 'メモ').locator('p');
    expect(await memo.innerText()).toBe('家族と分担\n  内訳：半分');
    await expect(page.getByRole('heading', { name: GUIDE_TITLE })).toHaveCount(0); // 最終無料日まで26日・請求日まで27日

    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });

  test('支払方法・メモが未入力なら出さず、URL が未登録なら「未登録：編集で追加できます」、トライアル OFF は「対象外」', async ({ page }) => {
    await openDetail(
      page,
      subscriptionDto({ subscriptionId: ID, nextBillingDate: '2026-11-30', paymentMethod: null, websiteUrl: null, cancelUrl: null, memo: ' 　\n' }),
    );
    await waitForDetail(page);
    const main = page.getByRole('main');
    await expect(main.getByText(/支払方法：/)).toHaveCount(0);
    await expect(infoRow(page, '無料トライアル')).toContainText('対象外');
    await expect(infoRow(page, '公式サイト')).toContainText(NOT_REGISTERED);
    await expect(infoRow(page, '解約ページ')).toContainText(NOT_REGISTERED);
    await expect(main.getByRole('heading', { level: 3, name: 'メモ' })).toHaveCount(0);
    await expect(main.getByText('月額換算', { exact: true }).locator('..')).toContainText('¥1,590');
    await expect(main.getByText('年額換算（参考）', { exact: true }).locator('..')).toContainText('¥19,080');
  });

  test('Push から開いたとき（?from=push）の 404 は「見つかりません」を出さずに S-08 へ移る（履歴を置き換える）', async ({ page }) => {
    await page.clock.setFixedTime(new Date(TODAY));
    const user = await loginAsNewUser(page);
    await mockApi(page, 'GET', '/api/account', accountResponse(user.email));
    await mockApi(page, 'GET', '/api/subscriptions/:id', { status: 404, error: { code: 'NOT_FOUND', message: 'サブスクが見つかりません' } });
    // 「見つかりません」が一度でも出たかを記録する（移る前に出していないことを確かめる）
    await page.addInitScript(() => {
      const w = window as unknown as { __notFoundShown: boolean };
      w.__notFoundShown = false;
      new MutationObserver(() => {
        if (document.body?.innerText.includes('見つかりません')) w.__notFoundShown = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto(`${DETAIL}?from=push`);
    await expect(page).toHaveURL(/\/notifications$/);
    expect(await page.evaluate(() => (window as unknown as { __notFoundShown: boolean }).__notFoundShown)).toBe(false);
    await page.goBack(); // 履歴を置き換えたので、S-06 には戻らない（その前の /terms）
    await expect(page).toHaveURL(/\/terms$/);
  });
});

// ---- S-11・S-12・S-09 ⑪ ----

// navigator.onLine を差し替える（window.__testOffline が true の間はオフライン）
async function startOffline(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __testOffline: boolean };
    w.__testOffline = true;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => !w.__testOffline });
  });
}

test.describe('S-11・S-12', () => {
  test('S-11：見出しの下の注意書き、図の本文、運営者の箇条書きの最後に公開範囲、問い合わせ先（メールアドレスなし）、末尾に版', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: '利用規約' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2, name: 'SubWatch 利用規約' })).toBeVisible();
    await expect(main.getByText(DISCLAIMER)).toBeVisible();
    for (const title of ['1. サービスの概要', '2. 運営者・対象年齢', '3. 禁止事項', '4. 免責', '5. 規約の変更', '6. 準拠法・施行日', '7. 問い合わせ先']) {
      await expect(main.getByRole('heading', { level: 3, name: title })).toBeVisible();
    }
    const operator = main.getByRole('heading', { level: 3, name: '2. 運営者・対象年齢' }).locator('..').getByRole('listitem');
    await expect(operator.first()).toHaveText('・運営者名：Eチーム');
    await expect(operator.last()).toHaveText(`・${PUBLICATION_SCOPE}`);
    await expect(main).toContainText('18歳未満の方は、保護者の同意を得てご利用ください');
    await expect(main).toContainText('準拠法：日本法');
    await expect(main).toContainText('施行日：2026年12月1日');
    await expect(main.getByText(CONTACT)).toBeVisible();
    await expect(main.getByText(`版：${process.env.NEXT_PUBLIC_TERMS_VERSION}`, { exact: true })).toBeVisible();
    expect(await main.innerText()).not.toMatch(/@/); // メールアドレスを書かない（D-5）
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
  });

  test('S-12：注意書き、運営者の箇条書きの最後に公開範囲、保存地域、外部サービス（Push の暗号化・favicon.im）、取得する情報、問い合わせ先、末尾に版', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'プライバシーポリシー' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2, name: 'SubWatch プライバシーポリシー' })).toBeVisible();
    await expect(main.getByText(DISCLAIMER)).toBeVisible();
    const operator = main.getByRole('heading', { level: 3, name: '1. 運営者' }).locator('..').getByRole('listitem');
    await expect(operator.last()).toHaveText(`・${PUBLICATION_SCOPE}`);
    await expect(main).toContainText('データの保存地域：日本（東京。Cloud Firestore）。ログイン情報は Firebase Authentication（Google）が管理します');
    await expect(main).toContainText('ブラウザの種類（User-Agent）');
    await expect(main).toContainText('同意の記録（同意した日時と、利用規約・プライバシーポリシーの版）');
    await expect(main).toContainText('ブラウザの Push サービス（Google・Apple など）：Push 通知の配信');
    await expect(main).toContainText('Push サービスは通知の内容（サービス名・請求日・料金）を読めません');
    await expect(main).toContainText('favicon.im');
    await expect(main).toContainText('通知履歴：作成から90日で削除します');
    await expect(main.getByText(CONTACT)).toBeVisible();
    await expect(main.getByText(`版：${process.env.NEXT_PUBLIC_PRIVACY_VERSION}`, { exact: true })).toBeVisible();
    expect(await main.innerText()).not.toMatch(/@/);
  });

  test('開いたときにオフラインなら「読み込めませんでした」「ネットワークを確認して再試行してください」と［再試行］。オンラインで［再試行］を押すと本文を出す', async ({ page }) => {
    await startOffline(page);
    for (const [path, title] of [
      ['/terms', 'SubWatch 利用規約'],
      ['/privacy', 'SubWatch プライバシーポリシー'],
    ] as const) {
      await page.goto(path);
      const alert = page.getByRole('main').getByRole('alert');
      await expect(alert).toContainText('読み込めませんでした');
      await expect(alert).toContainText('ネットワークを確認して再試行してください');
      await expect(page.getByRole('heading', { level: 2, name: title })).toHaveCount(0);
      await waitForHydration(page, 'main button');
      await page.evaluate(() => {
        (window as unknown as { __testOffline: boolean }).__testOffline = false;
      });
      await alert.getByRole('button', { name: '再試行' }).click();
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
      // 読んでいる途中で通信が切れても、本文は出したまま
      await page.evaluate(() => {
        (window as unknown as { __testOffline: boolean }).__testOffline = true;
        window.dispatchEvent(new Event('offline'));
      });
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
  });

  test('［戻る］：ログイン前は S-01 へ。ログイン中は S-09 ⑪から開いて［戻る］で S-09 に戻る', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 2, name: 'SubWatch 利用規約' })).toBeVisible();
    await waitForHydration(page, 'button');
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page).toHaveURL(/\/register$/);

    await loginAsNewUser(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
    // ⑪ 利用規約・プライバシーポリシーのリンク（同じタブ）
    const main = page.getByRole('main');
    await expect(main.getByText('内容を確認する')).toBeVisible();
    await expect(main.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', '/privacy');
    await main.getByRole('link', { name: '利用規約' }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { level: 2, name: 'SubWatch 利用規約' })).toBeVisible();
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  });
});

// ---- S-13 ----

function termsCheck(page: Page) {
  return page.getByRole('checkbox', { name: /利用規約/ });
}
function privacyCheck(page: Page) {
  return page.getByRole('checkbox', { name: /プライバシーポリシー/ });
}
function consentButton(page: Page) {
  return page.getByRole('main').getByRole('button', { name: /同意して続ける|処理中…/ });
}
function logoutButton(page: Page) {
  return page.getByRole('main').getByRole('button', { name: 'ログアウト', exact: true });
}
function deleteLink(page: Page) {
  return page.getByRole('button', { name: 'アカウントを削除する' });
}

async function openConsent(page: Page, { initialized }: { initialized: boolean }) {
  const user = await loginAsNewUser(page, { initialized });
  if (initialized) {
    await adminDb().collection('users').doc(user.uid).update({ termsVersion: OLD_VERSION, privacyVersion: OLD_VERSION });
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '同意の確認' })).toBeVisible();
  await waitForHydration(page, 'main button');
  return user;
}

test.describe('S-13 同意の確認', () => {
  test('版が古い人：②の文、③④をチェックするまで⑥は押せない。⑥で bootstrap（kind は送らない）→ consentHistory に reconsent が1件足され、ホームへ移る。幅375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const user = await openConsent(page, { initialized: true });
    const main = page.getByRole('main');
    await expect(main.getByText('利用規約・プライバシーポリシーが更新されました。内容を確認して同意してください')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'メニュー' })).toHaveCount(0);
    await expect(consentButton(page)).toBeDisabled();
    await termsCheck(page).check();
    await expect(consentButton(page)).toBeDisabled();
    await privacyCheck(page).check();
    await expect(consentButton(page)).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    const requests: unknown[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/account/bootstrap') requests.push(request.postDataJSON());
    });
    await consentButton(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(requests).toEqual([
      {
        termsAccepted: true,
        privacyAccepted: true,
        termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION,
        privacyVersion: process.env.NEXT_PUBLIC_PRIVACY_VERSION,
      },
    ]);
    const saved = (await adminDb().collection('users').doc(user.uid).get()).data()!;
    expect(saved.termsVersion).toBe(process.env.NEXT_PUBLIC_TERMS_VERSION);
    expect(saved.consentHistory).toHaveLength(2);
    expect(saved.consentHistory[1]).toMatchObject({ kind: 'reconsent', termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION });
  });

  test('users の無い人も同じ画面で、⑥で users が作られホームへ移る', async ({ page }) => {
    const user = await openConsent(page, { initialized: false });
    await termsCheck(page).check();
    await privacyCheck(page).check();
    await consentButton(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
    const saved = (await adminDb().collection('users').doc(user.uid).get()).data()!;
    expect(saved.consentHistory).toHaveLength(1);
    expect(saved.consentHistory[0]).toMatchObject({ kind: 'create' });
  });

  test('bootstrap の失敗：409 版違いは2行の文、503 は一時的な障害の文、通信の失敗・500 は「登録できませんでした…」。チェックは入れたままで、もう一度押せる', async ({ page }) => {
    await openConsent(page, { initialized: false });
    const bootstrap = await mockApi(page, 'POST', '/api/account/bootstrap', [
      { status: 409, error: { code: 'TERMS_RECONSENT_REQUIRED', message: '利用規約が更新されました。もう一度同意してください' } },
      { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません。時間をおいて再試行してください' } },
      'failure',
      { status: 500, error: { code: 'INTERNAL_ERROR', message: '処理に失敗しました' } },
      { status: 409, error: { code: 'CONFLICT', message: '競合しました。もう一度お試しください' } },
    ]);
    await termsCheck(page).check();
    await privacyCheck(page).check();
    const alert = page.getByRole('main').getByRole('alert');

    await consentButton(page).click();
    await expect(alert).toContainText('利用規約が更新されました。もう一度同意してください');
    await expect(alert).toContainText('続けて表示されるときは、画面を読み込み直してください');
    await expect(termsCheck(page)).toBeChecked();
    await expect(privacyCheck(page)).toBeChecked();
    await expect(page.getByRole('heading', { level: 1, name: '同意の確認' })).toBeVisible(); // サインアウトしない

    await consentButton(page).click();
    await expect(alert).toHaveText('一時的に利用できません。時間をおいて再試行してください');

    await consentButton(page).click();
    await expect(alert).toHaveText('登録できませんでした。もう一度お試しください');

    await consentButton(page).click();
    await expect.poll(() => bootstrap.calls()).toBe(4);
    await expect(alert).toHaveText('登録できませんでした。もう一度お試しください');

    await consentButton(page).click();
    await expect.poll(() => bootstrap.calls()).toBe(5);
    await expect(alert).toHaveText('登録できませんでした。もう一度お試しください');
    await expect(consentButton(page)).toBeEnabled();
    await expect(termsCheck(page)).toBeChecked();
  });

  test('No.36 ⑥の処理中は「処理中…」で、⑦ログアウトと⑧アカウントを削除するの両方が押せない', async ({ page }) => {
    await openConsent(page, { initialized: false });
    await mockApi(page, 'POST', '/api/account/bootstrap', { status: 503, error: { code: 'TEMPORARILY_UNAVAILABLE', message: '一時的に利用できません' }, delayMs: 4000 });
    await termsCheck(page).check();
    await privacyCheck(page).check();
    await expect(logoutButton(page)).toBeEnabled();
    await expect(deleteLink(page)).toBeEnabled();

    await consentButton(page).click();
    await expect(page.getByRole('main').getByRole('button', { name: '処理中…' })).toBeDisabled();
    await expect(logoutButton(page)).toBeDisabled();
    await expect(deleteLink(page)).toBeDisabled();

    // 応答が届いた後は、また押せる
    await expect(page.getByRole('main').getByRole('alert')).toContainText('一時的に利用できません。時間をおいて再試行してください');
    await expect(logoutButton(page)).toBeEnabled();
    await expect(deleteLink(page)).toBeEnabled();
  });

  test('⑧「アカウントを削除する」は users が無いときも、規約の版が古いだけのときも出て、押すと削除の確認ダイアログが開く', async ({ page, browser }) => {
    await openConsent(page, { initialized: false });
    await expect(deleteLink(page)).toBeVisible();
    await deleteLink(page).click();
    const dialog = page.getByRole('dialog', { name: 'アカウントを削除しますか？' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '次へ' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(dialog).toHaveCount(0);

    const other = await browser.newPage();
    try {
      await openConsent(other, { initialized: true });
      await expect(deleteLink(other)).toBeVisible();
      await deleteLink(other).click();
      await expect(other.getByRole('dialog', { name: 'アカウントを削除しますか？' })).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test('⑦ログアウトで S-02 へ移る', async ({ page }) => {
    await openConsent(page, { initialized: true });
    await logoutButton(page).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('③の「利用規約」から S-11 を開いて［戻る］で S-13 に戻ると、チェックは外れた状態に戻る', async ({ page }) => {
    await openConsent(page, { initialized: true });
    await privacyCheck(page).check();
    await page.getByRole('main').getByRole('link', { name: '利用規約' }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole('heading', { level: 2, name: 'SubWatch 利用規約' })).toBeVisible();
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '同意の確認' })).toBeVisible();
    await expect(termsCheck(page)).not.toBeChecked();
    await expect(privacyCheck(page)).not.toBeChecked();
  });
});
