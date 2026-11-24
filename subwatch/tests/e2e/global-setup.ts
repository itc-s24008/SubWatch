// 画面のテストの前に、Auth と Firestore の Emulator の両方が起動したことを確かめる
import '../env';

async function waitFor(name: string, url: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // まだ起動していない
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} の Emulator が起動していません（${url}）`);
}

export default async function globalSetup(): Promise<void> {
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  const firestore = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  await waitFor('Auth', `http://${auth}/`);
  await waitFor('Firestore', `http://${firestore}/`);
}
