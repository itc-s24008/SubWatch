// No.73 Firestore のルールが、ブラウザからの読み書きを全部拒否する（@firebase/rules-unit-testing の .firestore() を使う）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, it } from 'vitest';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-subwatch',
    firestore: { rules: readFileSync(path.resolve(process.cwd(), '../firestore.rules'), 'utf8'), host, port: Number(port) },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

describe('No.73 Firestore のルールが読み書きを全部拒否する', () => {
  it('ログインした本人でも、自分の users・サブスクを読めない・書けない', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(db.collection('users').doc('alice').get());
    await assertFails(db.collection('users').doc('alice').set({ email: 'a@example.com' }));
    await assertFails(db.collection('users').doc('alice').collection('subscriptions').doc('s1').get());
    await assertFails(db.collection('users').doc('alice').collection('subscriptions').doc('s1').set({ price: 1 }));
  });

  it('ログインしていない人も、どこも読めない・書けない（cronRuns を含む）', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('users').doc('alice').get());
    await assertFails(db.collection('cronRuns').doc('2026-11-04').get());
    await assertFails(db.collection('cronRuns').doc('2026-11-04').set({ status: 'running' }));
  });
});
