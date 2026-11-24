// ブラウザの Firebase（Auth だけ。Firestore はブラウザから使わない）。最初に使うときに初期化する
// NEXT_PUBLIC_USE_AUTH_EMULATOR=true のとき（ローカルの開発とテスト）は Auth Emulator（127.0.0.1:9099）につなぐ
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

let cachedAuth: Auth | null = null;

function clientApp(): FirebaseApp {
  return (
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    })
  );
}

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const auth = getAuth(clientApp());
  if (process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  cachedAuth = auth;
  return auth;
}
