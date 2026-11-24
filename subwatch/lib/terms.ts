// 規約・ポリシーの版の比較（firebase-admin を import しない。ブラウザからも使う）
// 比較は完全一致だけ（新旧の大小は判断しない）。環境変数の版が未設定・空なら、いつも false（API共通仕様 B11）

export interface TermsVersions {
  termsVersion: string;
  privacyVersion: string;
}

// 現行の版（環境変数）。未設定は空文字
export function currentTermsVersions(): TermsVersions {
  return {
    termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION ?? '',
    privacyVersion: process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? '',
  };
}

// users（または GET /api/account の応答）に保存された版が、現行の版と同じか
export function isTermsCurrent(user: { termsVersion?: unknown; privacyVersion?: unknown } | null | undefined): boolean {
  const current = currentTermsVersions();
  if (!current.termsVersion || !current.privacyVersion) return false;
  if (!user) return false;
  return user.termsVersion === current.termsVersion && user.privacyVersion === current.privacyVersion;
}
