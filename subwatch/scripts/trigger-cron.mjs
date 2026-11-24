// Cron（GET /api/cron/daily）を手で1回呼ぶ（04-14）。手で動かすのは創大だけ。12/1 の公開後は使わない
//
//   subwatch/ で：
//     node --env-file=$HOME/secrets/cron.env scripts/trigger-cron.mjs --url https://（公開URL）
//     node --env-file=$HOME/secrets/cron.env scripts/trigger-cron.mjs --url https://（公開URL） --reset
//
//   --url   呼び先（公開URL。末尾の / は付けても付けなくてもよい）。/api/cron/daily を足して呼ぶ
//   --reset 呼ぶ前に、今日（日本時間）の cronRuns/{今日の日付} の1件だけを消す（11/25 のα版のデモ用。公開前の Firebase プロジェクトに使う）
//
// 接続の値は、リポジトリの外の ~/secrets/cron.env から --env-file で読む（このスクリプトにも、リポジトリの中〔subwatch/.env.local を含む〕にも書かない）。
//   CRON_SECRET                    必須。Authorization: Bearer に付ける
//   FIREBASE_SERVICE_ACCOUNT_JSON  --reset のときだけ必須。サービスアカウントキーの JSON を Base64 にした1行（サーバーと同じ読み方で戻す）
// 鍵の値は画面に出さない（エラーの文にも入れない）
//
// .mjs のスクリプトは lib/ を import できないので、今日の日付は lib/clock.ts と同じ式でここに書く

function todayJST(now = new Date()) {
  // en-CA の書式は YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// 12/1 の公開の日から --reset は使わない（本番のデータを消さないため。手順書 04 の B-2）
const RESET_LAST_DAY = '2026-11-30';

function fail(message) {
  console.error(`エラー：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { url: null, reset: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reset') args.reset = true;
    else if (arg === '--url') {
      args.url = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--url=')) args.url = arg.slice('--url='.length);
    else fail(`知らない引数です：${arg}（使えるのは --url と --reset）`);
  }
  return args;
}

function cronUrl(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    fail('--url の形が違います（例：--url https://subwatch-xxxx.vercel.app）');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('--url は https:// で始めてください');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/cron/daily`;
  url.search = '';
  url.hash = '';
  return url;
}

// サービスアカウントキー（Base64 の1行）を戻す。lib/firebase-admin.ts と同じ読み方
function serviceAccountFromEnv() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!encoded) fail('FIREBASE_SERVICE_ACCOUNT_JSON がありません（--reset に必要。~/secrets/cron.env を --env-file で渡してください）');
  try {
    const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (typeof json.project_id !== 'string' || !json.project_id) throw new Error('project_id');
    return json;
  } catch {
    fail('FIREBASE_SERVICE_ACCOUNT_JSON を読めません（サービスアカウントキーの JSON を base64 -w0 にした1行か、確かめてください）');
  }
}

async function resetToday(serviceAccount, today) {
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }, 'trigger-cron');
  const ref = getFirestore(app).collection('cronRuns').doc(today);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    console.log(`cronRuns/${today} はありません（消すものなし）`);
    return;
  }
  await ref.delete();
  console.log(`cronRuns/${today} を消しました（状態は ${snapshot.get('status')}）`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) fail('--url https://（公開URL） を付けてください');
  const url = cronUrl(args.url);
  const secret = process.env.CRON_SECRET;
  if (!secret) fail('CRON_SECRET がありません（~/secrets/cron.env を --env-file で渡してください）');
  const today = todayJST();

  // 実行前にプロジェクトIDを表示する（--reset は、キーの project_id のプロジェクトの cronRuns を消す）
  let serviceAccount = null;
  if (args.reset) {
    if (today > RESET_LAST_DAY) fail(`--reset は 12/1 の公開の後は使いません（今日は ${today}）`);
    serviceAccount = serviceAccountFromEnv();
    console.log(`プロジェクトID：${serviceAccount.project_id}`);
  } else {
    console.log(`プロジェクトID：${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '（cron.env に NEXT_PUBLIC_FIREBASE_PROJECT_ID が無いので不明。呼び先の Vercel が使うプロジェクト）'}`);
  }
  console.log(`今日（日本時間）：${today}`);
  console.log(`呼び先：${url.origin}${url.pathname}`);

  if (args.reset) await resetToday(serviceAccount, today);

  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${secret}` } });
  } catch (error) {
    fail(`呼び出しに失敗しました（${error?.cause?.code ?? error?.name ?? '通信エラー'}）`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // JSON でない応答（Vercel のエラーページなど）
  }
  console.log(`HTTP ${res.status}`);
  if (body?.data) console.log(JSON.stringify(body.data));
  else if (body?.error) console.log(JSON.stringify({ code: body.error.code, message: body.error.message }));
  else console.log(text.slice(0, 200));
  if (!res.ok) process.exit(1);
}

main().catch((error) => {
  fail(error?.message ?? String(error));
});
