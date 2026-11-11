# SubWatch（Eチーム）開発ルール

このファイルは、リポジトリの直下に `CLAUDE.md` と `AGENTS.md`（同じ内容。Claude Code は CLAUDE.md を、Codex などは AGENTS.md を読む。28,000 バイト以下）として置く。続きの `docs/開発ルールの詳細.md` も同じ決まり（作業の前に読む）。自動で読めないAI（ブラウザのチャットなど）には、最初に両方の全文を貼る。どのAIも同じルールで作業する。

## このプロジェクト
サブスクの請求予定を管理する Web/PWA アプリ。3人が機能ごとに担当を分け、各自が AI で作成し、統合日（11/19・11/25・12/1）に全員で統合する。

## 3人
結愛＝比嘉（リーダー）、創大＝金城、星凪＝呉屋。設計書は姓、WBS は名で書いてある。

## フォルダ
- `subwatch/`：Next.js のアプリ本体。コマンドはここで実行する。
- `firebase.json`、`firestore.rules`、`firestore.indexes.json`：リポジトリの直下。
- `設計書テキスト/`：設計書の全文（セル座標つき）。読むのはこちら。
- `設計書図/`：画面の図（PNG・SVG）。図のオレンジの丸の番号は説明用で、画面には表示しない。機能設計書「図（フローチャート）」の図は、`フロー_（図の題）.png`。
- `AIプロンプト/`：タスクごとの指示。`手順書/`：人が行う手順。`設定ファイル/`：指示書がコピー元にするファイル。
- `docs/`：直下。決まりの一覧（`決まりの一覧.md`）、開発ルールの詳細（`開発ルールの詳細.md`。この続き）、不足メモ、統合記録。

## 仕様の決め方
1. 仕様は設計書と、決まりの一覧（`docs/決まりの一覧.md`）。設計書と決まりの一覧が食い違ったときは、決まりの一覧を優先する（その食い違いも不足メモに書く）。ここにない会話や別の資料を仕様にしない。
2. 3人の共通の約束は、機能設計書の「API一覧」「API共通仕様」「型定義」。必ずこのとおりに作る。
3. 優先：データ項目は DB設計書（物理名）、処理は機能設計書、文言は画面設計書と要件定義書「共通ルール」。
4. 推測した箇所、設計書の食い違いは `docs/不足メモ/04-xx.md`（タスクごとのファイル）に、シート名・セル・内容を書いて、報告する。設計書は書き換えない。

## 必ず守ること
- ブラウザから Firestore を読み書きしない（`firebase/firestore` を入れない。Rules は全拒否）。データは `app/api/**/route.ts` と firebase-admin を通す。ブラウザの firebase は Auth だけ。
- コレクションは users・subscriptions・notificationEvents・webPushSubscriptions・cronRuns の5つだけ。
- エラー形式、検査の順序、HTTP ステータスは「API共通仕様」のとおり。他人のデータは 404。
- 画面の文言は設計書をそのまま使う。幅375pxで横スクロールなし。ボタンとリンクは44px以上（押しても画面を移らない「リンク」〔S-02 ③・S-13 ⑧〕は、見た目がリンクの `<button>`）。PC は幅480pxを中央。`<h1>` は、画面のタイトルの1つだけにする（本文の中の題は `<h2>` 以下）。
- ゲートのエラーは 401 UNAUTHENTICATED・409 TERMS_RECONSENT_REQUIRED・409 ACCOUNT_NOT_INITIALIZED の3つだけ（`isGateError` が true）。このとき、どの画面・部品も失敗の文を出さない（ゲートが画面を切り替える）。`catch` の最初に `if (isGateError(error)) return;` と書く（bootstrap を呼ぶ S-01・S-13 は除く。下の「bootstrap の失敗」）。401 REAUTH_REQUIRED（削除のダイアログでパスワードを入れ直す）・503・ほかの 409（CONFLICT など）は含めない（画面は切り替わらず、その部品が文を出す）。Gates（画面を切り替える部品）は (auth) の画面（S-01・S-02）では判定しない。`onApiGate`（API の結果を受ける口）は S-01・S-02 でもこの3つに反応する。
- S-09 のスイッチ（③通知・④この端末で受け取る）の保存が失敗したら、スイッチを元へ戻す。`isGateError` のときは文を出さない。それ以外の失敗は、画面設計書 S-09 の文を出す（③「変更できませんでした…」、④はオンにするとき「登録できませんでした…」、オフにするとき「解除できませんでした…」）。④のオフは、先に DELETE /api/push/subscribe を呼び、成功してからブラウザの購読を解除する（失敗したら購読を残してオンのまま「解除できませんでした…」）。
- bootstrap の失敗（POST /api/account/bootstrap。S-01 と S-13）は、次の表のとおり。

  | 応答 | S-01（登録） | S-13（同意の確認） |
  |---|---|---|
  | 401 UNAUTHENTICATED | `onApiGate`（S-02 へ移動し、期限切れの文を出す） | 同左 |
  | 409（規約の版が違う） | サインアウト（signOut だけ）して S-02 へ移り「利用規約が更新されました。もう一度同意してください」 | ⑤の文 |
  | やり直せる失敗（503・500 RESOURCE_EXHAUSTED・409 CONFLICT・status 0） | サインアウトせず文を出す（503・RESOURCE_EXHAUSTED は一時的な障害の文、OFFLINE はオフラインの文、CONFLICT・NETWORK_ERROR・TIMEOUT は「登録できませんでした。もう一度お試しください」）。S-01 は同じ画面のまま下の「やり直す」画面に切り替える（チェックはしたまま） | 同じ文。ボタンをもう一度押せる |
  | それ以外（500 INTERNAL_ERROR など） | サインアウト（signOut だけ）して S-02 へ移り「登録は完了しましたが初期設定に失敗しました。もう一度ログインしてください」 | ⑤の「登録できませんでした…」 |

  S-01 は、開いたときにログイン済みなら、自分で GET /api/account を1回だけ読む（Gates は使わない。404 なら下の画面、200 ならホーム〔S-03〕へ `router.replace`）。ログイン済みで users が無いときの「やり直す」画面の形は、決まりの一覧 C-4 と 04-05 のとおり。S-02 はログイン済みでも自動で移動しない（ログイン済みのまま［ログイン］を押したら、先に `logout()` してから認証する）。
- `requireAuth` は、ID token の検証の失敗を 401 UNAUTHENTICATED と 503 TEMPORARILY_UNAVAILABLE に分ける。分け方の表は `docs/開発ルールの詳細.md` の 1（表にない失敗を 401 にしない。503 では画面はサインアウトしない。無料枠の超過は 500 RESOURCE_EXHAUSTED）。
- メール形式の検証は、入力欄の `type="email"` と Firebase の判定に任せる（独自の正規表現を作らない）。既読にしたら、S-08 ①の未読件数は画面で1減らす（「すべて既読」なら0）。S-03 ①のバッジは開くたびに読む数（持ち回らない）。
- Firebase の「メール列挙保護」は既定のまま有効にする。ログイン・再認証の失敗は、登録の有無にかかわらず `auth/invalid-credential` になる（ユーザーの有無を画面で分けない）。
- 同意の記録：bootstrap の transaction の中で、users の `consentHistory`（追記だけ。termsVersion・privacyVersion・acceptedAt・kind〔サーバーが決める。users を作る＝'create'、版の更新＝'reconsent'。S-01・S-13 で同じ〕。最大20件、古い順に消す）に1件足す。acceptedAt は transaction の前に `Timestamp.now()` で1回作り、`termsAcceptedAt` にも同じ値（配列の中で serverTimestamp を使わない。04-05）。
- アカウント削除の後片づけが3回とも失敗したら、ログに code `DELETE_CLEANUP_FAILED` だけを出す（uid は出さない。Firestore に記録しない。04-17）。残りは人が点検して消す（C-12。コードは作らない）。
- 200件のテストデータ（No.61）は API を呼ばず Admin SDK の `scripts/seed-200.ts`（tsx で実行）で入れる（項目と値は `docs/開発ルールの詳細.md` の 3 と `バグ修正.md` の 05-05）。
- 「前の画面へ戻る」は、`window.history.length > 1` なら `router.back()`。戻る先が無いときは、設計書の移動先へ `router.replace`。自動で S-02 へ移すとき（未ログイン・401・ログアウト・アカウント削除の後）も `router.replace`。（S-05 の編集の保存の後だけは別の判定。画面設計書 S-05 の⑱）
- 作らないもの：メール通知、LINE 連携、Google Calendar 連携、料金履歴（F-09・S-10）、画像のアップロード。
- サービスのアイコンは `components/IconBadge.tsx` の `IconBadge` を使う。画面ごとに頭文字の表示を作らない（favicon は 05-07 が `IconBadge` の中に足す）。
- ライブラリは機能設計書「0.実装構成」の版を使う（typescript は 5.9 系）。追加するときは Pull Request に書く。

## 担当の範囲
- 指示されたタスクの範囲だけを作る。ほかの人の担当のファイルは変えない。
- **共通ファイルは、このタスクの中で変えない**（04-01 は例外）。必要なら、変えたい内容を報告して止まる（創大に相談し、別の Pull Request で先に入れる）。
  - 共通ファイル：`lib/types.ts`、`lib/errors.ts`、`lib/http.ts`、`lib/auth.ts`、`lib/clock.ts`、`lib/format.ts`、`lib/billing.ts`（04-04 の後）、`lib/flash.ts`、`lib/logout.ts`、`lib/firebase-admin.ts`、`lib/firebase-client.ts`、`lib/api-client.ts`、`lib/terms.ts`、`lib/account.ts` の requireInitialized、`components/ui.tsx`、`components/Dialog.tsx`、`components/BottomNav.tsx`、`components/IconBadge.tsx`（05-07 だけは中身を変えてよい）、`app/layout.tsx`、`app/(main)/layout.tsx`、`app/(auth)/layout.tsx`、`app/(legal)/layout.tsx`、`app/(main)/settings/page.tsx`、`app/globals.css`、`package.json`、`package-lock.json`、`tsconfig.json`、`tsconfig.typecheck.json`、`postcss.config.mjs`、`tailwind.config.ts`、`next.config.ts`、`playwright.config.ts`、`vitest.config.ts`、`vitest.emulator.config.ts`、`global.d.ts`、`.env.development.example`、`tests/env.ts`、`tests/e2e/global-setup.ts`、04-01 が作ったテスト（`tests/emulator/base.test.ts`、`tests/e2e/smoke.spec.ts` など）
  - 枠を 04-01 が置き、中身を担当が書くファイル：`components/AuthProvider.tsx`・`components/Gates.tsx`（04-05。04-12 は AuthProvider に import を1行だけ足す）、`public/manifest.webmanifest`（04-12）。担当でない人は変えない。
  - みんなが足すファイル：`mocks/index.ts`、`tests/emulator/helpers.ts`、`tests/e2e/helpers.ts`、`lib/dashboard.ts`、`lib/account.ts`、`lib/notifications.ts`（04-14 が作り、04-21 が一覧・既読を足す）、`app/api/account/route.ts`（04-05 が GET で作り、04-17 が DELETE、04-21 が PATCH を足す）。自分の分を足すだけにして、ほかの人の行を変えない。足す場所は、自分の見出し（`// ===== 04-xx：… =====`。無ければ、最後に付ける）の下。import も見出しのすぐ下に書き、ファイルの先頭の import は変えない。すでに import されている名前は、もう一度 import しない。
  - プロンプトに「このタスクで変えてよい」と書いてあるファイル（例：04-20 が検索・並べ替えを足す S-04 のページ。S-04 を作るのは 04-09）は、書いてある範囲だけ変えてよい。
- 相手の機能が未完成の間、手で試すときは `NEXT_PUBLIC_USE_MOCKS=true` にして `mocks/index.ts` の仮データで動かす。画面は必ず `api()` を通す。ほかの切り替え方を作らない。
- S-09 の部品は、枠（`settings/page.tsx`）の中の、担当の部品のファイルだけを書く：`AccountInfo`・`AccountActions`（04-05）、`NotificationSection`（04-21）、`PushSection`・`NotificationTiming`〔⑥。props `withoutPush`〕（04-12）、`DeleteAccount`（04-17）、`LegalLinks`（04-19）。`DeleteAccount` は S-09 ではボタン、S-13 ではリンク（`trigger="link"`）で使う（props `trigger`・`onSuccess`・`disabled` の型と既定は 04-17）。失敗の文は、それぞれ自分のボタン・リンクのすぐ下に出す。削除の応答が届かない（通信の失敗か30秒の時間切れ。`timeoutMs: 30000`。送った後の status 0 はどれも）ときは、`runLocalCleanup()`（サーバーは呼ばない）→ お知らせ → サインアウト → S-02 で「削除が完了したか確認できませんでした。もう一度ログインしてください（パスワードを確かめてもログインできなければ、削除は完了しています）」。30秒の時間切れは `setTimeout` と `AbortController` で作る（`AbortSignal.timeout` は使わない）。Firebase のエラーの種類では判定しない（メール列挙保護）。［削除する］を押した時点（再認証の前）で `navigator.onLine` が false なら、再認証も DELETE もせず共通のオフラインの文（サインアウトしない。ダイアログは開いたまま）。`AccountInfo` は GET /api/account を自分で読まず、`useAccountGate().account` を使う（`NotificationSection`・`PushSection` が自分で読む。いつ読むかは各プロンプト）。
- S-13（同意の確認）は URL のない部品 `components/ConsentScreen.tsx`（枠は 04-01、中身は 04-19。props は `onDone: () => void` だけ。表示と、`onDone` の後の読み直し・ホームへの移動は Gates〔04-05〕）。⑦の下にリンク⑧「アカウントを削除する」をいつも出す（users/{uid} が無いときも、規約の版だけが古いときも）。S-09 の⑩と同じ3段階で、失敗の文はリンクのすぐ下、成功したら S-02。⑥の処理中は⑦⑧の両方を押せない（⑧には `disabled` を渡す）。

## 共通部品の形（全員がこの名前で使う。04-01 が作る）
- すべて名前付き export。import は `@/`（`subwatch/` 直下を指す）。
- サーバー（`lib/firebase-admin.ts`）：`adminAuth()`、`adminDb()`
- サーバー（`lib/http.ts`）：`withApi(handler)`（route を包み、エラーを API共通仕様の形にする）、`ok(data, status = 200)`、`noContent()`、`readJsonBody(req)`、`rejectUnknownKeys(body, allowed)`
- サーバー（`lib/errors.ts`）：`new HttpError(status, code, message?, extras?)`、`fromFirestoreError(error)`（HttpError を返す。`withApi` が自動でかけるので、route では呼ばなくてよい）
- サーバー（`lib/auth.ts`）：`requireAuth(req, { checkRevoked? })` → `{ uid, email, authTime }`（`authTime` は ID token の `auth_time`。秒）。401 と 503 の分け方は `docs/開発ルールの詳細.md` の 1
- サーバー（`lib/account.ts`）：`requireInitialized(uid, { checkTerms? })` → 読んだ users（`UserDoc`。ふつうは route でもう一度読まなくてよい）。サブスクの登録・削除（POST /api/subscriptions・DELETE /api/subscriptions/:id）、Push 購読の登録、Cron の通知イベントの作成は、users/{uid} を読む transaction の中で行う（理由と、users が無くなっていたときの扱いは 04-07）。PATCH /api/account は update だけで、users を作り直さない。DELETE /api/account は requireInitialized を呼ばない（users が無くても削除できる）。`UserDoc`（DB設計書 テーブルNo.1 の物理名）も、ここに置く
- 共通（`lib/terms.ts`）：`isTermsCurrent(user)`（firebase-admin を import しない。ブラウザからも使う）
- 共通（`lib/clock.ts`）：`todayJST(now = new Date())`。今日の日付はこれだけで得る。テストでは引数で渡す
- 共通（`lib/billing.ts`。04-04 が作る）：`nextBillingDate(firstBillingDate, billingCycle, billingDayMode, today)`、`nthBillingDate(firstBillingDate, billingCycle, billingDayMode, k)`、`billingDatesInRange(firstBillingDate, billingCycle, billingDayMode, from, to)`、`annualAmount(price, billingCycle)`、`monthlyEquivalentTotal(annualTotal)`（1件分の月額換算は `monthlyEquivalentTotal(annualAmount(price, billingCycle))`）。日付の部品も、ここのものを全員が使う（自分で作らない）：`isValidDate(s)`、`isEndOfMonth(s)`、`addDays(s, n)`、`daysBetween(a, b)`、`daysInMonth(year, month)`、`weekdayOf(s)`。日付は引数も戻り値も YYYY-MM-DD の文字列。壊れた入力は `RangeError`（画面は catch して「―」。細部は 04-04 が各関数の上のコメントに書く）。ブラウザからも使う（firebase を import しない）
- 共通（`lib/format.ts`）：`formatYen`、`formatMonthDay`、`formatTimeJST`、`formatUnreadBadge`、`CATEGORY_LABELS`、`BILLING_CYCLE_LABELS`（S-05 の表示名）、`BILLING_CYCLE_UNIT_LABELS`（S-04 の「/ 月」の単位）、`BILLING_DAY_MODE_LABELS`
- 共通（`lib/types.ts`）：機能設計書「型定義」のすべて（`NotificationEvent`・`PushResult`・`ConsentRecord` と、保存の形の `SubscriptionDoc`・`NotificationEventDoc`・`CronRunDoc` を含む。ほかのファイルで定義し直さない）
- ブラウザ（`lib/firebase-client.ts`）：`getFirebaseAuth()`
- ブラウザ（`components/AuthProvider.tsx`）：`useAuth()` → `{ user, loading }`（`user` は未ログインなら null）。`useAccountGate()` → `{ status, account, error, loadAccount }`（04-05 が足す。Gates が読んだ GET /api/account の値と、同意が必要かの状態）
- ブラウザ（`lib/api-client.ts`）：`api<T>(path, { method?, body?, skipGate?, timeoutMs? })`（`skipGate: true` のときは `onApiGate` を呼ばない。ログアウトの途中の DELETE /api/push/subscribe だけが使う。`timeoutMs` の時間内に応答が無ければ通信を止め、`ApiClientError`（`status` 0、`code` `TIMEOUT`）を投げる。DELETE /api/account（30000）だけが使う）、`ApiClientError`（`status`、`code`、`field`、`details`、`candidates`、`requestId`）、`onApiGate(listener)`（反応するのは「必ず守ること」の3つだけ。bootstrap の 409 では呼ばない。細部は 04-01・04-05）、`isGateError(error)`（同じ3つだけ true）、`MOCKS_ENABLED`。204 のとき `api()` は `undefined` を返す。通信できないときは `status` が 0、`code` が `OFFLINE` か `NETWORK_ERROR`
- 仮データ（`mocks/index.ts`）：`mockResponse(method, path, body)`。値は基準日 2026-11-04 のテストデータ。仮データは検証と請求日の計算をしない（本物では 400 もある）
- ブラウザ（`lib/flash.ts`）：`setFlash(text)`、`takeFlash()`（画面移動後の表示文。サインアウトして S-02 へ移すときは signOut の前に置く）
- ブラウザ（`lib/logout.ts`）：`logout()`（登録した処理を最大3秒実行し〔Push の DELETE を待つのは2.5秒まで〕、失敗しても signOut する。画面は移さない。S-02 へは Gates〔S-01 は自分で移る〕）、`registerBeforeLogout(fn)`（Push の解除などを登録する）。ログアウトでは、DELETE /api/push/subscribe の結果にかかわらず、ブラウザの購読を必ず解除する。ブラウザに購読が無い端末では、この DELETE を呼ばない（呼ぶときは `skipGate: true`）。S-09 と S-13 のログアウトは必ず `logout()` を使う（アカウント削除の後は使わない。04-17）。サーバーを呼ばない後始末：`registerLocalCleanup(fn)`（戻り値は登録の解除。04-12 が登録する）、`runLocalCleanup()`（全部実行。最大3秒。例外を投げない。呼ぶ所は 04-05・04-17）。細部は 04-12
- 画面（`components/ui.tsx`）：`Button`、`LinkButton`、`PageTitle`、`Card`、`FieldError`、`TextField`、`Loading`、`LoadError`、`EmptyState`、`Select`（選択欄）、`Switch`（切替）、`RadioGroup`、`Checkbox`（同意のチェック欄。S-01・S-13 で同じ部品）、`Brand`（題の上の「SubWatch」）。`components/Dialog.tsx`：`Dialog`。props は、各部品の上のコメントに書いてある。`LoadError` は、`error`（`api()` のエラー）を渡すと共通の文（オフライン・一時的な障害）を優先する。`commonErrorMessage(error)` は、その共通の文を返す（合わなければ null。`LoadError` の外〔ダイアログ・スイッチの文〕で使う）。機能ごとの文は `message` で渡す。選択欄・切替・ラジオボタン・題の上の「SubWatch」も、ここの部品を使う。`components/IconBadge.tsx`：`IconBadge`（props は部品の上のコメント。04-01 の時点では頭文字だけ。S-07・S-08 は常に頭文字なので `initialOnly` を付ける）
- 後のタスクが作り、ほかの人も使う部品（main に入った後は、同じ規則を別に書かずに、これを使う。まだ無いときは、自分のファイルに仮に書いて報告し、統合日にそろえる）
  - `lib/subscriptions.ts`（04-07。サーバー）：`listSubscriptions(uid)`（全件を作成日時の昇順で返す。保存の形）、`toSubscriptionDto(doc, today?)`。サブスクをサーバーで読むときは、これを使う
  - `lib/validation.ts`（04-07。ブラウザからも使う）：`hasCardLikeNumber`、`hasHttpScheme`（URL の判定。保存の検証、S-05 の入力、S-06 のリンクで同じものを使う）、`duplicateKey`（同名の判定と、S-04 の検索の正規化）、`isSubscriptionId`
  - `lib/calendar.ts`（04-13。ブラウザからも使う）：`isCalendarMonth`、`monthOf`、`calendarMonthOf`、`shiftMonth`、`monthDateRange`（月の1日と末日）、`calendarWeeks`
  - 統合日にそろえる名前（統合の手順8）：`unreadWindowStart(now)`（直近90日の境目）、`isFirestoreNotFound(e)`（lib/errors.ts）、`SUBSCRIPTION_LIMITS`（件数などの上限の定数）、`toDashboardSubscription`（04-09）、`recordAlerts`（tests/e2e/helpers.ts）

## route の書き方（検査の順序は、この順に呼ぶことで守る）
```ts
export const runtime = 'nodejs';          // 各 route.ts の先頭に、この2行を書く
export const dynamic = 'force-dynamic';   // route.ts からは、HTTP メソッドの関数と route segment config（この2つ、maxDuration など）だけを export する

export const POST = withApi(async (req) => {
  const user = await requireAuth(req);            // 1. 認証
  await requireInitialized(user.uid);             // 2. 初期設定と規約の版
  // 3. :id のあるルートは、ここで対象を確かめる（形式が違う・無い・他人のものは 404）
  //    :id は withApi<{ id: string }>(async (req, { params }) => { const { id } = await params; … }) で受け取る
  const body = await readJsonBody(req);           // 4. 本文
  rejectUnknownKeys(body, ALLOWED_KEYS);          // 5. 未知のキー
  // 6. 項目の検証 → 7. 処理（順序の全体は API共通仕様）
  return ok(result, 201);
});
```

## テストの置き場所
- `tests/unit/`：計算と検証（vitest）。`tests/emulator/`：API（vitest と Emulator）。`tests/e2e/*.spec.ts`：画面（Playwright）。
- テストの道具（`tests/emulator/helpers.ts`・`tests/e2e/helpers.ts`）、page.clock・mockApi の使い方、Push の画面テスト、決まりの分岐のテスト、差し替え口、テスト名の番号、No.41 の決まりは `docs/開発ルールの詳細.md` の 2 にある。テストを書く前に必ず読む。

## 秘密の値
- 鍵・トークン・`.env.local` の中身を、読まない、表示しない、コードに書かない、コミットしない。
- 本物の値は各自の `~/secrets/` の中だけに置き、リポジトリの中（`subwatch/.env.local` を含む）には置かない。
- `.claude/settings.json` は鍵のファイルの読み取りやコマンドの一部を止めるが、事故防止で完全ではなく（書き方を変えれば通る）、Codex などには効かない。どの AI も、止められていなくても鍵のファイルや `~/secrets` を開かない・表示しない、`firebase deploy`・`vercel` を実行しない。止められたら、回避しない。
- テストは Emulator とダミーの値（project: demo-subwatch）で行う。本物の Firebase に書き込むコマンドを、人に確かめずに実行しない。

## 終わるとき
1. `npm run typecheck`、`npm test`、`npm run build`、関係するときは `npm run test:emulator`、`npm run test:e2e` を実行し、結果をそのまま報告する（要約しない。実行していないものは、実行していないと書く）。
2. 実機、本番の Firebase、Vercel で確かめていないことは、未確認と書く。「完成」と書かない。
3. 次を箇条書きで報告する（Pull Request の AI 記録欄に貼る）：作ったファイル／推測した箇所／自分で確かめられなかったこと／統合のときに直してほしい所（仮に書いた関数、仮の方法で操作したテスト。`docs/不足メモ/` にも書く）。
4. コミットと push は、人が内容を読んでから行う。例外：統合日のまとめ役の AI は、人がその日の統合を承認した後に、統合用ブランチへのマージとコミットをしてよい（push は人が行う）。
