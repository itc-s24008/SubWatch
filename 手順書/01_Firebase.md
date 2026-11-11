# 01 Firebase の準備（04-03。結愛。副担当：星凪〔確認は 11/12 の4限の前〕。11/12）

所要：約20分。無料の Spark プランでよい（クレジットカード不要）。

## 1. プロジェクトを作る
**最初に（11/12 の始めに）確かめること：** 学校の Google Workspace のアカウントで作ると、組織のポリシー（`iam.disableServiceAccountKeyCreation`）で、5 のサービスアカウントキーが作れないことがある。プロジェクトは個人の Gmail で作る。学校のアカウントで作るなら、先に管理者にキーを作れるか聞く。プロジェクトを作ったら、すぐ 5 を試し、キーが作れることを確かめてから 2 以降に進む。
1. https://console.firebase.google.com を開き、Googleアカウント（個人の Gmail）でログインする。
2. 「プロジェクトを追加」→ 名前（例：eteam-subwatch）→ Googleアナリティクスは「無効」→ 作成。

## 2. ウェブアプリを登録して、設定値を控える
1. プロジェクトの概要 →「</>（ウェブ）」→ ニックネーム（例：subwatch-web）→ Firebase Hosting は「チェックなし」→ 登録。
2. `firebaseConfig` の次の4つを控える。
   - `apiKey` → NEXT_PUBLIC_FIREBASE_API_KEY
   - `authDomain` → NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
   - `projectId` → NEXT_PUBLIC_FIREBASE_PROJECT_ID
   - `appId` → NEXT_PUBLIC_FIREBASE_APP_ID

## 3. Authentication を有効にする
1. 「構築」→「Authentication」→「始める」。
2. 「ログイン方法」→「メール/パスワード」→ 有効にする（「メールリンク」は不要）→ 保存。
3. 「設定」→「パスワード ポリシー」で、最小文字数を 8、適用（enforcement）を「必須（Require）」にして保存する（S-01 の確認と同じ8文字。再設定の画面でも8文字未満を拒否するため。項目が無いとき・無料のプランで使えないときは何もせず、04-03 の完了の報告と報告書（`docs/報告書.md`）に「パスワード ポリシーは使えなかった（再設定の画面は Firebase の既定のまま）」と書く〔S-01 の確認だけで8文字にする。決まりの一覧 C-16〕）。
4. 「設定」→「ユーザー アクション」の「メール列挙保護」は、既定のまま有効にしておく（オフにしない）。有効だと、ログイン・再認証の失敗は、登録の有無にかかわらず `auth/invalid-credential` になる（アプリはこれを前提に作る）。

## 4. Firestore を作る
1. 「構築」→「Firestore Database」→「データベースを作成」。
2. ロケーション：**`asia-northeast1`（東京）**（プライバシーポリシーに書いた保存地域。あとで変えられない）。モード：「本番環境モード」。

## 5. サービスアカウントキー（サーバー用・秘密）
1. 歯車 →「プロジェクトの設定」→「サービスアカウント」→「新しい秘密鍵を生成」→ JSON がダウンロードされる。**キーは1回だけ作る**（押すたびに新しいキーが増える。間違えて2つ作ったら、使わない方を消す。キーは Firebase の画面では消せないので、この画面の「サービスアカウントの権限を管理」〔Google Cloud の画面〕を開き、`firebase-adminsdk-…` のサービスアカウント →「キー」で、使わない方のキー ID を削除する〔手順書 04 の後片付けと同じ〕。ダウンロードのフォルダからも消す）。
   - **創大へ：** 創大が自分のキーを作るとき（6）は、同じサービスアカウントに結愛のキーがすでにある。「キー」の画面では、自分が今作ったキー（作成日が今日で、ダウンロードした JSON の `private_key_id` と同じ ID のもの）以外は**消さない**。結愛のキーを消すと、本番の API が全部動かなくなる。間違えて2つ作ったときに消すのも、自分が今日作った方だけ。
   - 「キーの作成が無効」「組織のポリシー」などのエラーで作れないときは、1 の注意のとおり。個人の Gmail でプロジェクトを作り直すか、管理者に頼む。
2. **GitHub に上げない。AIにも貼らない。** ダウンロードしたら、すぐ `~/secrets/` に移す（`~/Downloads` に残さない）。先に、自分だけが読めるフォルダを作っておく（手順書 03 の 6 と同じ。01 は 03 より先に行うので、ここで作る）：
   ```bash
   mkdir -p ~/secrets && chmod 700 ~/secrets
   DL="$(xdg-user-dir DOWNLOAD 2>/dev/null)"; [ -n "$DL" ] && [ "$DL" != "$HOME" ] || DL="$(ls -d ~/Downloads ~/ダウンロード 2>/dev/null | head -n1)"   # ダウンロードのフォルダ（ホームだけが返るときは ~/Downloads か ~/ダウンロード）
   ls "$DL"/*adminsdk*.json            # 1つだけ出ることを確かめる（2つ以上なら、上の 1 のとおり使わない方を消す）
   mv "$DL"/*adminsdk*.json ~/secrets/subwatch-key.json && chmod 600 ~/secrets/subwatch-key.json
   ls "$DL" | grep adminsdk            # 何も出なければよい
   base64 -w0 ~/secrets/subwatch-key.json > ~/secrets/key-base64.txt && chmod 600 ~/secrets/key-base64.txt
   test -s ~/secrets/key-base64.txt && echo OK    # OK と出ればよい（出なければ、mv が失敗している。上から確かめ直す）
   ```
   本物の値は `~/secrets/` の中だけに置き、リポジトリの中（`subwatch/.env.local` を含む）には置かない。
3. Vercel に入れる値は、上で作った `~/secrets/key-base64.txt`（貼り方は手順書 03 の 6）。画面に鍵を表示しない。

## 6. 値を渡す
ローカルの開発に本物の値はいらない。Vercel のプロジェクトは、11/17 の2限に星凪が自分のパソコンで作る（手順書 02 の 4）。
- 設定値4つ（`NEXT_PUBLIC_`。秘密ではない）：結愛が、2 で控えた値をチームのチャットで星凪に渡す。星凪が自分のパソコンで Vercel に入れる。
- サービスアカウントキー（秘密）：結愛のパソコンで貼る（結愛は 04-05 の途中で10分抜ける）。星凪が結愛のパソコンでシークレットウィンドウから Vercel にログインし、結愛が自分のクリップボードから貼る。同じ場で星凪が Deploy Hook を作り、結愛が画面のコピーボタンで `~/secrets/deploy-hook.txt` に写す（叩くのは 11/18。手順書 02 の 4 の B と 5-2）。終わったら星凪がログアウトする。本番の鍵が正しいことは、11/19 の統合①（04-10）で本番にテスト用アカウントを1つ登録して確かめる。鍵をチャット・ファイル・USB で渡さない。
- 結愛が休んだとき：04-01 の確認は星凪が行う。11/12 に休んだときは、この手順（04-03）を次の授業日の1限に結愛が行う（04-01 の段階1〜2 は Emulator だけで作れる）。鍵の貼り付けもその日に回す（Rules の反映〔7〕は 11/18 の 04-07 の最初に創大が行う）。11/17 に休んだときは、鍵の貼り付けと Deploy Hook の作成を 11/18 の4限の最後の30分に回す（決まりの一覧 B-9）。
- 創大が Cron のリセット（`scripts/trigger-cron.mjs --reset`）に使うキーは、6-2 で招待された後に、創大が 5 と同じ手順で自分のキーを作り（作るのは 11/24 の 04-14 の中で、CRON_SECRET を作るとき。決まりの一覧 B-2）、自分の `~/secrets/` に置く（先に `mkdir -p ~/secrets && chmod 700 ~/secrets`。5 の「創大へ」のとおり、結愛のキーは消さない）。キーは誰からも受け取らないし、誰にも渡さない。チャットに貼らない。

## 6-2. 創大と星凪を招待する
歯車 →「ユーザーと権限」→「メンバーを追加」で、2人のGoogleアカウントを追加する（ロールは編集者）。これをしないと、創大が 11/18 の 04-07 の最初に deploy できず、星凪がドメインや cronRuns を見られない。
創大と星凪は、届いたメールの招待を開いて受ける（受けるまで、Firebase のコンソールにプロジェクトが出ない）。受けた後に、https://console.firebase.google.com でプロジェクトが見えることを確かめる。

## 7. ルールとインデックスを反映する（11/18 の 04-07 の最初。創大。10分。04-07 が最初に使うため。決まりの一覧 B-9）
リポジトリの直下で（結愛に招待されていること）：
```bash
npm install -g firebase-tools    # nvm で入れた Node.js なので sudo は付けない（手順書 03 の 1）
firebase login
firebase use --add          # 作ったプロジェクトを選ぶ。別名は default。`.firebaserc` はコミットしてよい
firebase deploy --only firestore:rules,firestore:indexes
```
Firestore の「インデックス」画面で、状態が「有効」になるのを待つ（数分）。

## 8. Vercel のドメインを追加する（初回デプロイの後。11/17 の2限）
Authentication →「設定」→「承認済みドメイン」に、Vercel の本番のドメインを追加する。追加するのは、Vercel → Project → Settings → Domains に出ているもの（例：`eteam-subwatch.vercel.app`。`https://` は付けない）。デプロイごとにできる URL（`eteam-subwatch-xxxx-….vercel.app` のような、Deployments の各行の URL）は足さない。追加しないと、公開URLでログインできない（11/25 のα版に必要）。
