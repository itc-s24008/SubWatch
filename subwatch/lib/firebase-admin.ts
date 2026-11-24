// サーバーの Firebase（Admin SDK）。最初に使うときに初期化する（環境変数が無くてもビルドが通るように）
// FIREBASE_SERVICE_ACCOUNT_JSON（サービスアカウントキーの JSON を Base64 にした文字列）があればそれを使う。
// 空のとき（ローカルの開発とテスト）は、FIREBASE_AUTH_EMULATOR_HOST・FIRESTORE_EMULATOR_HOST の Emulator につなぐ
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const APP_NAME = 'subwatch-admin';
let cachedApp: App | null = null;

function adminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) {
    cachedApp = existing;
    return existing;
  }
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined;
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (encoded) {
    const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as { project_id?: string };
    cachedApp = initializeApp(
      { credential: cert(serviceAccount as Parameters<typeof cert>[0]), projectId: serviceAccount.project_id ?? projectId },
      APP_NAME,
    );
  } else {
    cachedApp = initializeApp({ projectId }, APP_NAME);
  }
  return cachedApp;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}
