// 画面を移った後に出す文（S-02 のお知らせなど）。サインアウトして S-02 へ移すときは、signOut の前に setFlash する
// 1つだけ持つ（後から置いた文で上書き）。takeFlash は読んだら消す
const KEY = 'subwatch.flash';

export function setFlash(text: string): void {
  try {
    window.sessionStorage.setItem(KEY, text);
  } catch {
    // ストレージが使えない環境では出さない
  }
}

export function takeFlash(): string | null {
  try {
    const text = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}
