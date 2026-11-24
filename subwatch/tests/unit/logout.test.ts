import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => undefined) }));
vi.mock('@/lib/firebase-client', () => ({ getFirebaseAuth: () => ({}) }));

import { registerLocalCleanup, runLocalCleanup } from '@/lib/logout';

describe('runLocalCleanup（サーバーを呼ばない後始末）', () => {
  const unregister: (() => void)[] = [];
  afterEach(() => {
    unregister.splice(0).forEach((fn) => fn());
    vi.useRealTimers();
  });

  it('登録した処理を全部実行する', async () => {
    const a = vi.fn();
    const b = vi.fn(async () => undefined);
    unregister.push(registerLocalCleanup(a), registerLocalCleanup(b));
    await runLocalCleanup();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('例外を投げる処理があっても、ほかの処理を実行し、例外を投げない', async () => {
    const ok = vi.fn();
    unregister.push(
      registerLocalCleanup(() => {
        throw new Error('失敗');
      }),
      registerLocalCleanup(async () => {
        throw new Error('失敗');
      }),
      registerLocalCleanup(ok),
    );
    await expect(runLocalCleanup()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('終わらない処理があっても、最大3秒で終わる', async () => {
    vi.useFakeTimers();
    unregister.push(registerLocalCleanup(() => new Promise(() => undefined)));
    let done = false;
    const running = runLocalCleanup().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(done).toBe(true);
  });

  it('登録を解除した処理は実行しない', async () => {
    const fn = vi.fn();
    const off = registerLocalCleanup(fn);
    off();
    await runLocalCleanup();
    expect(fn).not.toHaveBeenCalled();
  });
});
