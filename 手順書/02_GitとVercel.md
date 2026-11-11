# 02 Git と Vercel の準備（04-02。星凪。11/12 と 11/17 の2日。11/12 は 1〜3 と、4 の準備。Vercel の作成と初回デプロイは 11/17 の2限。Deploy Hook の確認は 11/18 の1限〔5-2〕。04-03〔Firebase〕の確認は、11/12 の4限の前に星凪が行う）

> **2026-11-11 の変更（決まりの一覧 B-10・補足22）**：リポジトリは `https://github.com/itc-s24008/SubWatch`（Public。持ち主は創大）。GitHub の持ち主の操作、Vercel の画面の操作（プロジェクトの作成・環境変数・Redeploy・ログ・停止）、マージボタンは、**創大が行う**（星凪から移した。この書類の文も書き換えてある）。タスクの担当と時間（04-02・04-23 など）は変えない：星凪が手順を進め、画面の操作の所だけを創大が行う。

休んだ人がいるとき（決まりの一覧 B-1）：
- 創大が休んだ日：12/1 より前は、結愛が main へマージしてよい（開発を止めない。GitHub の Write 権限は3人ともある）。本番への反映は、Deploy Hook の確認（11/18。5-2）が通っていれば結愛が Deploy Hook を叩き、通っていなければ創大が戻った日に `subwatch/` の中の1行を変えたコミットを創大が push して出す（6 の 3）。12/1 以降は手順書 05 の 7。Vercel の画面の操作（環境変数・Redeploy・ログ）は次の授業日に回す。
  - 11/12 に休んだとき：04-01 の段階1〜2 のマージは結愛が行う（リポジトリは 11/11 に作ってある）。Vercel の準備と初回デプロイ（4）は創大が戻る日に回す。
  - 11/17 に休んだとき：初回デプロイ（4）は 11/18 の4限の最後の30分に行う（決まりの一覧 B-9。1限の最初の30分は口頭確認とマージと Deploy Hook の確認だけ）。
- 星凪が休んだ日：11/17 の段階3〜4 と 04-04 の確認は結愛が行う（マージは創大）。
- 結愛が休んだ日：04-01 の確認は星凪が行う。11/17 に休んだときは、04-06 の確認は創大が行い、鍵の貼り付けと 04-02 の確認と Deploy Hook の作成（4 の B・C）は 11/18 の4限の最後の30分に回す（Deploy Hook の確認〔5-2〕もその後に行う）。

## 1. リポジトリを作る
1. リポジトリは作ってある（2026-11-11。`https://github.com/itc-s24008/SubWatch`。Public。README だけが入った状態で作り、同じ日に設計書とルール一式を入れた。下の 2 は済み）。
2. Settings → Collaborators で、結愛と創大を招待する。
3. 結愛と創大は、GitHub から届く招待（メール、または https://github.com/itc-s24008/SubWatch/invitations）を開いて「Accept invitation」を押す。受けるまで clone・push できない。
4. 結愛と創大の GitHub へのログインは、`gh auth login`（GitHub.com → HTTPS → ブラウザでログイン）か、**classic** の Personal Access Token（`repo` にチェック）を使う。fine-grained の PAT は、ほかの人の個人のリポジトリ（創大の `SubWatch`）へ push できないことがあるので使わない（手順書 03 の 2）。

## 2. 最初のファイルを入れる
**先に（11/12 の1限の初めに）星凪が入れておくもの：** この 2 では `git`・`gh`・`python3-openpyxl` を使う。手順書 03 の 1 より先に行うので、ここで入れる（03 の 1 と同じもの。入っていれば不要）：
```bash
sudo apt install -y git gh python3-openpyxl
git --version && gh --version    # どちらも版が出ればよい
```
Ubuntu の版が古く `gh` が見つからないときは、`gh` を使わず、下の PAT の方法で push する。

ローカルで次の形を作る。配られたフォルダ（`SubWatch_最新版_20261106/`）は、フォルダの名前がリポジトリと違うので、次の表のとおりに名前を変えてコピーする。

| 配られたフォルダ | リポジトリの中の名前 |
|---|---|
| `01_計画書とスケジュール表/` の xlsx 2冊（企画提案書・WBS）だけ | `設計書/` |
| `02_設計書（要件・画面・DB・機能）/` の xlsx 4冊 | `設計書/`（上と同じフォルダ） |
| `01_計画書とスケジュール表/決まりの一覧.md` | `docs/決まりの一覧.md`（手順書とプロンプトが「決まりの一覧 B-1」などで指す。CLAUDE.md も、設計書と食い違ったときはこれを優先する） |
| `01_計画書とスケジュール表/変更履歴.md`、`試し実行の要約.md` | `docs/変更履歴.md`、`docs/試し実行の要約.md` |
| `05_設定ファイル（CLAUDE.md など）/開発ルールの詳細.md` | `docs/開発ルールの詳細.md`（CLAUDE.md の続き。CLAUDE.md がこの場所で指す） |
| `03_AIに渡すプロンプト/` | `AIプロンプト/` |
| `04_手順書（人が行う手順）/` | `手順書/` |
| `05_設定ファイル（CLAUDE.md など）/` | `設定ファイル/` |
| `06_設計書図（AIが読む図）/` | `設計書図/` |

`01` の PDF（`確認用PDF`）、スクリーンショット、md は `設計書/` に入れない（`決まりの一覧.md`・`変更履歴.md`・`試し実行の要約.md` だけは `docs/` に入れる）。

```bash
SRC=~/Downloads/SubWatch_最新版_20261106    # 配られたフォルダの場所に直す
mkdir -p SubWatch/設計書 && cd SubWatch
cp -a "$SRC"/01_計画書とスケジュール表/*.xlsx 設計書/
cp -a "$SRC"/02_設計書（要件・画面・DB・機能）/*.xlsx 設計書/
mkdir -p docs && cp -a "$SRC"/01_計画書とスケジュール表/{決まりの一覧,変更履歴,試し実行の要約}.md docs/
cp -a "$SRC/03_AIに渡すプロンプト" AIプロンプト
cp -a "$SRC/04_手順書（人が行う手順）" 手順書
cp -a "$SRC/05_設定ファイル（CLAUDE.md など）" 設定ファイル    # フォルダごとコピーする（. で始まるファイルも入る）
cp -a "$SRC/06_設計書図（AIが読む図）" 設計書図
cp 設定ファイル/開発ルールの詳細.md docs/    # CLAUDE.md の続き（CLAUDE.md が docs/開発ルールの詳細.md で指す）
ls 設計書 docs            # 設計書に xlsx が6冊、docs に 決まりの一覧.md・変更履歴.md・試し実行の要約.md・開発ルールの詳細.md の4つ
ls -a 設定ファイル        # .gitignore.example、.env.development.example、.env.local.example があること
cp 設定ファイル/CLAUDE.md CLAUDE.md && cp 設定ファイル/CLAUDE.md AGENTS.md
wc -c CLAUDE.md AGENTS.md   # どちらも同じ大きさで 28,000 以下（Codex が AGENTS.md を読む上限 32,768 バイトより小さくするため。決まりの一覧 D-4）
mkdir -p .claude .github
cp 設定ファイル/claude-settings.json .claude/settings.json
cp 設定ファイル/.gitignore.example .gitignore
cp 設定ファイル/pull_request_template.md .github/pull_request_template.md
cp 設定ファイル/firebase.json 設定ファイル/firestore.rules 設定ファイル/firestore.indexes.json 設定ファイル/設計書テキスト書き出し.py .
```
`設定ファイル/*` のように `*` でコピーすると、`.` で始まるファイル（`.gitignore.example` など）が入らない。必ずフォルダごとコピーし、`ls -a` で3つのファイルを確かめる。

```
SubWatch/
  CLAUDE.md、AGENTS.md         ← どちらも 設定ファイル/CLAUDE.md（同じ内容。AIの開発ルール）
  .claude/settings.json        ← 設定ファイル/claude-settings.json（Claude Code が鍵を読まない設定）
  .gitignore                   ← 設定ファイル/.gitignore.example
  .github/pull_request_template.md ← 設定ファイル/pull_request_template.md
  firebase.json、firestore.rules、firestore.indexes.json ← 設定ファイル/
  設定ファイル/                ← .env.local.example、.env.development.example、vercel.json.04-14で配置、icon-dictionary.json、icons/
  設計書テキスト書き出し.py    ← 設定ファイル/
  設計書/                      ← Excel 6冊（01 の企画提案書・WBS の2冊と、02 の要件・画面・DB・機能の4冊。PDF とスクリーンショットは入れない）
  設計書図/                    ← 図（画面の図と、フローチャート `フロー_….png`）
  docs/決まりの一覧.md         ← 01 の 決まりの一覧.md（決まりの正。docs/ には後で統合記録・テスト仕様書・報告書も置く）
  docs/変更履歴.md、docs/試し実行の要約.md ← 01 の同じ名前のファイル
  docs/開発ルールの詳細.md     ← 設定ファイル/開発ルールの詳細.md（CLAUDE.md の続き）
  AIプロンプト/、手順書/        ← 一式
```
`Work/`、`参考実装/`、`Work/app-src`（動作見本）は**入れない**。以前の方式の指示（`AIプロンプト/_旧版/`、`手順書/_旧版/`）と、図を作るときの指示（`設計書図/設計書図_作成プロンプト.md`）も入れない（下のコマンドで消す）。

```bash
pwd    # SubWatch の中にいることを確かめる（上の cd で入っている）
rm -rf AIプロンプト/_旧版 手順書/_旧版 設計書図/設計書図_作成プロンプト.md   # 使わないものを消す
git init -b main
git config --global user.name "（自分の名前）"                     # 最初のコミットの前に一度だけ（手順書 03 の 2 と同じ。済んでいれば不要）
git config --global user.email "（GitHub に登録したメールアドレス）"
python3 設計書テキスト書き出し.py     # 設計書テキスト/ を作る
git add .
git -c core.quotePath=false ls-files | grep -iE '(^|/)\.env($|\.)|cron\.env|key|secret|vapid|adminsdk' | grep -v '\.example$' || echo "OK：鍵のファイルなし"
git grep -nE 'eyJ0eXBlIjoic2VydmljZV9hY2NvdW50|ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIs|BEGIN PRIVATE KEY|"private_key": "-----BEGIN|FIREBASE_SERVICE_ACCOUNT_JSON=.|VAPID_PRIVATE_KEY=.|CRON_SECRET=.' -- . ':!*.example' ':!AIプロンプト' ':!手順書' || echo "OK：鍵の中身なし"
git commit -m "設計書とルールを入れる"
gh auth login        # 最初の push の前に一度だけ（下の説明）
git remote add origin https://github.com/itc-s24008/SubWatch.git
git push -u origin main
```
最初の push の前に、GitHub へのログインを済ませておく。GitHub CLI（`gh`）があれば `gh auth login`（GitHub.com → HTTPS → ブラウザでログイン）。無いときは、`git push` でパスワードを聞かれたら、GitHub のパスワードではなく Personal Access Token（PAT。GitHub → Settings → Developer settings → Personal access tokens で作る）を貼る。創大は自分のリポジトリなので fine-grained（対象は `SubWatch`、Contents を Read and write）でもよい。結愛と創大は classic（`repo` にチェック）を使う（1 の 4。手順書 03 の 2 と同じ）。

`OK：鍵のファイルなし` と `OK：鍵の中身なし` の両方が出なければ、コミットしないで相談する（1つ目は、名前に key・secret・vapid などを含むファイル（`.example` を除く）を出す。鍵でないと分かれば進めてよい）。

## 3. main を守る
リポジトリは Public なので、ブランチの保護ルール（Settings → Branches の「Require a pull request before merging」など）を使うこともできるが、足さない（Private で作る前提で決めた運用を、そのまま続ける）。「main に直接 push しない。main へは Pull Request のマージだけで入れる」を3人のチームのルールとして守る（例外は 6 の 3 の1行の変更で、創大だけが行う）。

Settings → General → Pull Requests で、「Allow merge commits」だけをオンにし、「Allow squash merging」と「Allow rebase merging」はオフにする（Hobby プランでは、コミットの作者が創大でないとデプロイが止まることがあるため。Private のリポジトリでの報告で、Public で起きるかは未確認。マージのコミットなら、作者はマージボタンを押した創大になる。6）。創大が休んだ日は、Deploy Hook の確認が通っていれば結愛がマージボタンを押し、本番へは Deploy Hook で反映する（5-2）。

## 4. Vercel のプロジェクトを作り、初回デプロイする（11/17 の2限。04-02 の続きで0.5時間）
- 11/12 の4限までに、創大が準備する（手順は星凪が進める）：Vercel のアカウント（Hobby プラン）を作り、Vercel の GitHub App に `SubWatch` を許可しておく（下の A の 2 の「Install」）。04-01 の段階1〜2（ビルドが通る土台）は、11/12 の4限のうちに創大がマージする。
- 11/17 の2限に、A（創大のパソコン）→ B（結愛のパソコン。10分）→ C（創大のパソコン）の順に続けて行う。結愛は 04-05 の途中で10分抜けて B に来る。鍵（サービスアカウント）と Deploy Hook の作成だけを結愛のパソコンで行い、ほかの設定と Redeploy は創大が自分のパソコンで行う。
- 段階1〜2 が 11/12 に main に入らなかったときは、11/17 の1限に入れ、初回デプロイは3限に回す。
- 創大が休んだときは、創大が戻る日に回す（11/17 なら 11/18 の4限の最後の30分）。結愛が休んだときは、A まで進め、B と C の確認は 11/18 の4限の最後の30分に回す（鍵が無いので API は動かない。決まりの一覧 B-9）。

### A. 創大のパソコンで（創大が操作する。手順は星凪が進める）
1. 結愛が、Firebase の設定値4つ（`NEXT_PUBLIC_`。手順書 01 の 2。秘密ではない）を、チームのチャットで星凪に渡す。
2. 創大が自分のパソコンで https://vercel.com に「Continue with GitHub」でログインする → Hobby プラン。「Add New」→「Project」→ `SubWatch` を「Import」。一覧に `SubWatch` が出ないときは、Vercel の GitHub App を入れる：「Install」（または「Adjust GitHub App Permissions」）→「Only select repositories」→ `SubWatch` を選ぶ →「Install」。
3. **Root Directory：`subwatch`**。Framework は Next.js。
   - Node.js Version は **22.x**（Settings → Build and Deployment。`package.json` の `engines` も `"22.x"`）。
4. 作る画面の Environment Variables には、秘密でない値（`NEXT_PUBLIC_` で始まるもの）だけを入れる（作る画面では Environments や Sensitive を選べないため。秘密の値はここでは入れない）。値は 1 でチャットに届いたもの：
   - NEXT_PUBLIC_FIREBASE_API_KEY、NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN、NEXT_PUBLIC_FIREBASE_PROJECT_ID、NEXT_PUBLIC_FIREBASE_APP_ID
   - NEXT_PUBLIC_TERMS_VERSION=2026-12-01、NEXT_PUBLIC_PRIVACY_VERSION=2026-12-01
5. 「Deploy」（Vercel は作るときにデプロイまで進む。鍵がまだ無いので、API は動かなくてよい）。本番のドメイン（Settings → Domains に出るもの。例：`eteam-subwatch.vercel.app`）を控える（手順書 01 の 8 で Firebase に足す。デプロイごとの URL ではない）。**12/1 の正式な公開まで、URL を共有しない。**
   - 作った後に、Settings → Environment Variables を開き、上の `NEXT_PUBLIC_` の値の Environments を **Production だけ**に直す（Preview は使わない。8）。
6. Project → Settings → Functions → Function Region を **Tokyo（hnd1）** にする。04-14 からは `vercel.json` の `"regions": ["hnd1"]` でも決まる。
7. 同じ画面で **Fluid compute が有効**になっていることを確かめる（無効なら有効にする）。04-14 の Cron の関数は `maxDuration` 300 秒を使い、これは Fluid compute が有効なときだけ使える。
8. Preview（main 以外のブランチのデプロイ）は使わないので、自動で作られないようにする：Settings → Git → Ignored Build Step で「Only build production」を選ぶ（画面の名前が違うときは、Settings → Git の中で Preview の自動デプロイを止める設定を探す）。鍵を Preview に入れないので、Preview のデプロイが作られても動かない。
6〜7 の変更は、C の Redeploy で入る（ここでは Redeploy しない）。

### B. 結愛のパソコンで（10分。鍵と Deploy Hook の作成だけ）
1. 結愛のパソコンでシークレットウィンドウを開き、創大が https://vercel.com にログインする（2段階認証の端末〔スマートフォンなど〕を持っていく）。
2. Settings → Environment Variables で、秘密の値 FIREBASE_SERVICE_ACCOUNT_JSON を足す。Environments は **Production だけ**を選び、**Sensitive をオン**にしてから保存する（こうすれば、鍵は1回貼るだけで済む）。値は、結愛が自分のクリップボードから貼る（`~/secrets/key-base64.txt`。貼り方は手順書 03 の 6）。鍵をチャット・ファイル・USB で渡さない。
3. 創大が Deploy Hook を作る：Settings → Git → Deploy Hooks で、名前 `main-hook`、ブランチ `main` →「Create Hook」。出た URL を、結愛が画面のコピーボタンでコピーし、自分のパソコンに保存する（チャット・AIに貼らない。URL を知っていれば誰でも本番のデプロイを動かせる）：
   ```bash
   umask 077 && xclip -selection clipboard -o > ~/secrets/deploy-hook.txt && chmod 600 ~/secrets/deploy-hook.txt    # Wayland なら xclip の代わりに wl-paste
   test -s ~/secrets/deploy-hook.txt && echo OK
   ```
   ここでは叩かない（叩くのは 11/18 の1限の確認。5-2）。
4. 創大がログアウトする。結愛は 04-05 に戻る。

### C. 創大のパソコンに戻って（Redeploy）
1. 創大が自分のパソコンで、Deployments → 最新の Production → Redeploy を押す（B で入れた鍵と、6〜7 の変更が入る）。Ready になるのを待つ（数分）。
2. 04-02（デプロイ）の確認：創大・星凪・結愛が、公開URL（本番のドメイン）でログイン画面が開くことを一緒に見る（結愛が副担当として確かめる）。
3. 結愛が、本番のドメインを Firebase の承認済みドメインに足す（手順書 01 の 8）。
- 本番の鍵が正しいことは、ここでは確かめない（ログイン画面は鍵が無くても開く）。11/19 の統合①（04-10）で、本番にテスト用アカウントを1つ登録して確かめる（手順書 05）。

**本番に入れてはいけないもの（Production に入れない）：** NEXT_PUBLIC_USE_MOCKS（入れると、仮データが出てログインを求めなくなる）、ALLOW_CRON_RUNDATE_OVERRIDE（入れると、Cron の日付を外から変えられる）、SUBSCRIPTION_LIMIT_OVERRIDE、NEXT_PUBLIC_USE_AUTH_EMULATOR、FIREBASE_AUTH_EMULATOR_HOST、FIRESTORE_EMULATOR_HOST。

環境変数は、足したり変えたりしても、今動いているデプロイには入らない。`NEXT_PUBLIC_` で始まる値も、CRON_SECRET・VAPID の鍵などのほかの値も、変えたら必ず Redeploy する（Deployments → 最新の Production → Redeploy。Vercel の画面の操作なので創大が行う。創大が休んだ日は次の授業日に回す）。

## 5. あとから足す環境変数（Vercel の操作は創大のアカウントに集める）
鍵を持つ人（VAPID は結愛、CRON_SECRET は創大）が値を作る。授業で、**鍵を持つ人のパソコンで**、創大が Vercel にシークレットウィンドウでログインし（2段階認証の端末を持っていく）、鍵を持つ人が自分のクリップボードから貼る。終わったら創大がログアウトする（鍵をチャット・ファイル・USB で渡さない。星凪に値を見せない）。Environments は Production だけ（Preview は使わない。4 の A の 8）。入れた後は Redeploy する。
- **Sensitive をオンにする変数：** CRON_SECRET、VAPID_PRIVATE_KEY、FIREBASE_SERVICE_ACCOUNT_JSON（入れた後は画面で値が見えなくなる。値は担当者が手元に持つ）。
- **VAPID_SUBJECT（本番）：** チームの人が実際に受け取れるメールアドレスを `mailto:（アドレス）` の形で入れる（リーダーの結愛の学校のメールアドレスにする）。`.env.development.example` の `mailto:dev@example.com` は使わない。
- **NEXT_PUBLIC_VAPID_PUBLIC_KEY（本番）：** 手順書 03 の 6 で作った値（`subwatch/` の中で `npx --yes web-push@3.6 generate-vapid-keys --json` を使う。`--yes` が無いと、入れてよいかの質問の文が JSON に混ざる）。`.env.development.example` の値（ローカル用のダミー）を入れない。


| いつ | 変数 |
|---|---|
| 11/19 の4限の最後の15分に、結愛のパソコンで貼る（値は結愛が手順書 03 の 6 で作る。創大がログイン。04-11・04-12 の時間に含む。04-12 を止めて 11/24 に作るときも、鍵は 11/19 に貼っておく。11/19 に結愛か創大が休んだら、次の授業日の4限の最後の15分） | NEXT_PUBLIC_VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY（秘密）、VAPID_SUBJECT |
| 11/24（04-14 の日）の4限の最後の15分に、創大のパソコンで貼る（値は創大が 04-14 で作る。創大がログイン。11/24 に創大が休んだら 11/25 の午前） | CRON_SECRET（秘密） |

11/25 のα版（04-16）の統合で、`vercel.json`（crons）を本番に入れる（CRON_SECRET は 11/24 に入れてある）。11/26 から、毎朝本番の Cron が動く（手順書 04 の B-2）。Redeploy の後に、Vercel の画面（左の「Schedules」→「Cron Jobs」タブ。前の画面では Settings → Cron Jobs）に、同じ `/api/cron/daily` が3本（9時台用 `0 0 * * *`、11時台用 `0 2 * * *`、18時台用 `0 9 * * *`）あることを確かめる（同じ path を複数の Cron で使うことは、Vercel の文書にも書かれている使い方。2026-11-10 に確かめた）。それでも3本そろって出ないときや、同じ path の Cron が複数あることでデプロイそのものが失敗するときは、`vercel.json` の2本目と3本目の path を `/api/cron/daily?slot=2`・`/api/cron/daily?slot=3` に変える（route は `?slot` を読まないので、動きは同じ）。変えたことを `docs/統合記録.md` に書く。

## 5-2. Deploy Hook の確認と、Deploy Hook で本番に反映する（結愛）
Deploy Hook は、叩くと main の最新のコミットを本番にデプロイする URL（4 の B で作り、結愛の `~/secrets/deploy-hook.txt` にある）。Hobby プランで、創大以外（結愛）がマージしたコミットを Deploy Hook がデプロイできるかは、公式文書では確かめられていないので、次の確認で決める。
- **確認（11/18 の1限の最初の30分の終わり）：** 3本のマージの後で、main で `npm run build`（`subwatch/` の中）が通ることを確かめてから、結愛が自分で作った小さな Pull Request（`subwatch/` の中の1行。例：`subwatch/README.md` に1行足す。Root Directory の外〔リポジトリ直下の README など〕の変更は、ビルドが飛ばされることがある）を、星凪が読んでから（副担当の確認の代わり）、結愛がマージボタンを押してマージし、自分のパソコンで叩く：`curl -fsS -X POST "$(cat ~/secrets/deploy-hook.txt)" > /dev/null && echo OK`。創大が Vercel の Deployments で、そのコミットが本番に出た（Ready）かを見て、結果を `docs/統合記録.md` に書く（まとめ役の代わりに創大が書いてよい。main に直接 push しないので、ブランチ `docs/integration-record-1112` を作って書き、Pull Request で入れる。手順書 05 の 1）。
- **確認が通ったとき：** 創大が休んだ日（統合日を含む）は、結愛が main へマージした後に、自分のパソコンで上と同じように叩く。叩いた後は、GitHub の main のコミットの横の印（Vercel のチェック）か、公開URLで、変更が入ったことを確かめる（Vercel の画面は創大のアカウントなので開かない）。
- **確認が通らなかったとき（止まった・失敗した）：** 12/1 より前に創大が休んだ日は、結愛がマージしてよい（開発を止めない）が、本番には出ない。創大が戻った日に、`subwatch/` の中の1行を変えたコミットを創大が push して出す（6 の 3）。統合日に創大が休んだときは、11/25 のα版のデモはローカル（Emulator）で行い、12/1 は公開を 12/3 に延ばす（決まりの一覧 B-3。手順書 05）。
- 環境変数の追加・変更、Redeploy、ログを見ることは、Deploy Hook ではできない。次の授業日に星凪が行う。

## 6. 無料プランの確認（11/17〜11/18。必ず行う）
Vercel の Hobby プランと Private リポジトリの組み合わせでは、持ち主以外のコミットでデプロイが止まるという報告がある（公式文書では未確認）。SubWatch のリポジトリは Public なので、起きるかどうかは分からない。下の確認は予定どおり行う。Hobby プランは共同作業者を持てないため。
- **決まり：main へのマージボタンは創大が押す**（Hobby は共同作業者を持てないため、ほかの人のコミットだとデプロイが止まることがある）。統合の Pull Request も、3人で読んだ後に創大が押す。創大が休んだ日（統合日を含む）は結愛が押す（12/1 より前。12/1 以降は手順書 05 の 7）。本番へは、Deploy Hook の確認（5-2）が通っていれば Deploy Hook で、通っていなければ創大が戻った日に 3 の1行の変更で反映する。
1. 初回デプロイの**後に**、ほかの人の Pull Request が main に入ったとき（11/17 の3限の初めの 04-01 の段階3〜4、11/18 の1限の 04-04・04-05・04-06）、Vercel の Deployments で動いたかを創大が見る。
2. 動けば、そのまま進める。
3. `does not support collaboration` などで止まったら、創大が main に `subwatch/` の中の1行を変えたコミットを push する（作者が創大のコミットになるので、GitHub からの自動デプロイが動き、それまでの main の中身が本番に出る。空のコミットや Root Directory〔`subwatch`〕の外の変更では、ビルドが飛ばされることがある）：
   ```bash
   git switch main && git pull
   echo "<!-- 本番に反映 $(date +%F) -->" >> subwatch/README.md
   git add subwatch/README.md && git commit -m "本番に反映する" && git push    # subwatch/README.md が未追跡でも入るように git add する
   ```
   main に直接 push してよいのは、このときの創大だけ（3 のチームのルールの例外）。止まったら統合日ごとに星凪が行い、行ったことを `docs/統合記録.md` に書く（記録はブランチと Pull Request で入れる。手順書 05 の 1）。

## 7. うまくいかないとき
| 症状 | 対処 |
|---|---|
| ビルドが失敗 | Build Logs の赤い行を読む。環境変数の入れ忘れ、Root Directory の間違い、typescript の版（5.9系）が多い |
| 04-14 の後、デプロイで `maxDuration` の上限のエラーが出る | `vercel.json` は Cron の関数に 300 秒を指定している。Project → Settings → Functions で Fluid compute が有効かを見る（4 の A の 7。300 秒は Fluid compute が有効なときだけ使える）。有効にしてもだめなら 60 に下げて、創大に知らせる |
| Vercel のログインを求められる | Settings → Deployment Protection → Vercel Authentication の対象を確かめる。Production だけ外す（Preview は使わないので、オンのままでよい）。それができずに全部を無効にしたときは、Preview の自動デプロイが止まっていること（4 の A の 8）を確かめる |
| 11/25 の統合の後、Cron のことでデプロイが失敗する（同じ path が3本） | `vercel.json` の2本目と3本目の path を `/api/cron/daily?slot=2`・`?slot=3` に変えて、もう一度 main に入れる（5 の最後） |
| 鍵を GitHub に上げてしまった | すぐに鍵を無効にする（Firebase の「プロジェクトの設定」→「サービスアカウント」から Google Cloud の画面を開き、そのキーを削除して作り直す。手順書 01 の 5）。履歴から消すだけでは足りない |
