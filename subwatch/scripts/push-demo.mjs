// 自分の購読にテストの Push を送る（04-15。手で確かめるための道具。Emulator に向けて動かす）
//   subwatch/ で：node --env-file=.env.development.local scripts/push-demo.mjs --email （S-09 で購読した利用者のメールアドレス）
//   --subscription （サブスクの ID）を付けると、タップでそのサブスクの詳細（/subscriptions/（ID）?from=push）を開く通知にする（無ければホーム）
//   --dry-run を付けると、送らずに送り先の数だけを出す
// 接続の値（FIRESTORE_EMULATOR_HOST など）と VAPID の鍵は、--env-file で読む（このファイルに書かない）。
// Emulator に向いていないとき（FIRESTORE_EMULATOR_HOST・FIREBASE_AUTH_EMULATOR_HOST が無いとき）は、何もせずに終わる（本番には向けない）。
// 送る中身は、本物の通知と同じ形（{ title, body, url, notificationId }。詳細_F-06 の 8-5）。url は /（ホーム）か /subscriptions/（ID）
// ログに endpoint・鍵は出さない（出すのは件数と HTTP ステータスだけ）
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import webpush from 'web-push';

function argOf(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = argOf('--email');
const dryRun = process.argv.includes('--dry-run');
const subscriptionId = argOf('--subscription');
if (subscriptionId !== undefined && !/^[A-Za-z0-9]{1,64}$/.test(subscriptionId)) {
  console.error('--subscription には、サブスクの ID（英数字）を書いてください');
  process.exit(1);
}

if (!email) {
  console.error('使い方：node --env-file=.env.development.local scripts/push-demo.mjs --email （メールアドレス） [--subscription （サブスクの ID）] [--dry-run]');
  process.exit(1);
}
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Emulator に向いていません（FIRESTORE_EMULATOR_HOST・FIREBASE_AUTH_EMULATOR_HOST が無い）。--env-file=.env.development.local を付けてください。本番には向けません');
  process.exit(1);
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-subwatch';
const app = getApps()[0] ?? initializeApp({ projectId });
const db = getFirestore(app);

let uid;
try {
  uid = (await getAuth(app).getUserByEmail(email)).uid;
} catch {
  console.error('そのメールアドレスの利用者が Emulator にいません');
  process.exit(1);
}

const snapshot = await db.collection('users').doc(uid).collection('webPushSubscriptions').get();
console.log(`購読：${snapshot.size}件`);
if (snapshot.empty) {
  console.log('S-09 で「この端末でPushを受け取る」をオンにしてから、もう一度実行してください');
  process.exit(0);
}
if (dryRun) {
  console.log('--dry-run なので送りません');
  process.exit(0);
}

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;
if (!publicKey || !privateKey || !subject) {
  console.error('VAPID の鍵が設定されていません（.env.development.local の NEXT_PUBLIC_VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT）');
  process.exit(1);
}

const payload = JSON.stringify({ title: 'SubWatch：テストの通知', body: 'Push の受信を確かめるための通知です', url: subscriptionId ? `/subscriptions/${subscriptionId}` : '/', notificationId: 'push-demo' });
let index = 0;
for (const doc of snapshot.docs) {
  index += 1;
  const data = doc.data();
  try {
    const res = await webpush.sendNotification({ endpoint: data.endpoint, keys: { p256dh: data.p256dh, auth: data.auth } }, payload, {
      TTL: 60,
      urgency: 'normal',
      vapidDetails: { subject, publicKey, privateKey },
      timeout: 10_000,
    });
    console.log(`${index}件目：送った（HTTP ${res.statusCode}）`);
  } catch (error) {
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : '通信エラー';
    console.log(`${index}件目：送れなかった（${status}）`);
  }
}
