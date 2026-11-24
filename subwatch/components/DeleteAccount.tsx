'use client';
// S-09 の⑩［アカウントを削除］と、S-13 の⑧「アカウントを削除する」（04-17。詳細_F-07、画面設計書 S-09 ⑩・S-13 ⑧・状態・ダイアログ一覧）
// ダイアログの中身と処理はここ1つだけ（S-09・S-13 で同じ部品を使う。2つ作らない）。文と判定は lib/account-delete-flow.ts
//
// props（型と既定）：
//   trigger?: 'button' | 'link'   入口の形。省略すると 'button'（S-09 ⑩。<DeleteAccount /> のまま使う）。
//                                 'link' は S-13 ⑧（見た目がリンクの <button>。押してもダイアログを開くだけで画面を移らない。決まりの一覧 C-14）
//   onSuccess?: () => void        削除が済んだ後、S-02 へ移る代わりに呼ぶ（後始末・お知らせ・signOut は渡しても行う）。省略すると S-02 へ移る。
//                                 今は S-09・S-13 とも渡さない
//   disabled?: boolean            true のとき入口のボタン・リンクを押せない（S-13 で⑥の処理中・ログアウト中に使う）。既定 false
//
// 流れ：①確認（前後の空白を除いて DELETE と一致したら［次へ］）→ ②パスワードの再入力（［削除する］）→ ③DELETE /api/account
//   ・［削除する］を押した時点で navigator.onLine が false：再認証も DELETE もせず、共通のオフラインの文（ダイアログは開いたまま）
//   ・パスワードが空・違う：「パスワードが違います」（入力は残す。DELETE は呼ばない）。再認証のそのほかの失敗は④と同じ
//   ・成功：runLocalCleanup() → setFlash（完了の文）→ signOut → S-02 へ router.replace（logout() は使わない。削除後は 401 になるため）
//   ・応答が届かない（送った後の status 0。通信の失敗・30秒の時間切れ・OFFLINE）：runLocalCleanup() → setFlash（確認できなかった文）→ signOut → S-02
//   ・401 REAUTH_REQUIRED：ダイアログの中に「もう一度パスワードを入力してください」、入力欄を空にする
//   ・401 UNAUTHENTICATED（ゲート）：何も出さない（AuthProvider が S-02 へ移す）
//   ・④そのほかの失敗（500・503 など）：ダイアログを閉じ、入口のすぐ下に「削除できませんでした。もう一度お試しください」（サインアウトしない）
//   ［削除する］を押した後は「削除中…」。終わるまで［キャンセル］も押せず、Esc でも閉じない
// 入力欄の ref は TextField の残りの props として <input> に渡る（React 19 では ref も props。TextField の props の型には無いので spread で渡す）
import { EmailAuthProvider, reauthenticateWithCredential, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from '@/components/Dialog';
import { Button, LinkButton, TextField } from '@/components/ui';
import {
  DELETE_CONFIRMATION,
  DELETE_MESSAGES,
  DELETE_TIMEOUT_MS,
  deleteFailureOf,
  deleteResultOf,
  isBrowserOffline,
  isDeleteConfirmationInput,
  reauthFailureOf,
  type DeleteOutcome,
} from '@/lib/account-delete-flow';
import { api, isGateError } from '@/lib/api-client';
import { getFirebaseAuth } from '@/lib/firebase-client';
import { setFlash } from '@/lib/flash';
import { runLocalCleanup } from '@/lib/logout';
import type { DeleteAccountBody, DeleteAccountResult } from '@/lib/types';

export interface DeleteAccountProps {
  trigger?: 'button' | 'link';
  onSuccess?: () => void;
  disabled?: boolean;
}

type Step = 'closed' | 'confirm' | 'password';

const ROW =
  'flex min-h-11 w-full items-center rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-left text-base font-bold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:text-gray-400';

export function DeleteAccount({ trigger = 'button', onSuccess, disabled = false }: DeleteAccountProps) {
  const router = useRouter();
  const baseId = useId();
  const [step, setStep] = useState<Step>('closed');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null); // ②の入力欄の下（パスワード違い・再認証・オフライン）
  const [entryError, setEntryError] = useState<string | null>(null); // 入口のすぐ下（削除の失敗）
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const canNext = isDeleteConfirmationInput(confirmText);

  function setBusyState(next: boolean) {
    busyRef.current = next;
    setBusy(next);
  }

  function openDialog() {
    if (disabled || busyRef.current) return;
    setEntryError(null);
    setConfirmText('');
    setPassword('');
    setDialogError(null);
    setStep('confirm');
  }

  function closeDialog() {
    if (busyRef.current) return;
    setStep('closed');
  }

  function goNext() {
    if (!canNext) return;
    setDialogError(null);
    setStep('password');
  }

  // ④そのほかの失敗：ダイアログを閉じ、入口のすぐ下に文を出す（もう一度押せば①からやり直す）
  function showFailure() {
    setBusyState(false);
    setStep('closed');
    setEntryError(DELETE_MESSAGES.failed);
  }

  // この端末の後始末（サーバーを呼ばない Push 購読の解除。04-12 が登録する。最大3秒・例外を投げない）→ お知らせ → signOut → 移動
  async function leave(flash: string, deleted: boolean) {
    await runLocalCleanup();
    setFlash(flash); // signOut の前に置く（決まりの一覧 C-14）
    try {
      await signOut(getFirebaseAuth());
    } catch {
      // サインアウトの失敗でも移る
    }
    if (deleted && onSuccess) onSuccess();
    else router.replace('/login');
  }

  async function submit() {
    if (busyRef.current) return;
    setDialogError(null);
    // 押した時点でオフラインなら、再認証も DELETE もしない（サインアウトしない。ダイアログは開いたまま）
    if (isBrowserOffline()) {
      setDialogError(DELETE_MESSAGES.offline);
      return;
    }
    // 空のときは Firebase を呼ばずに「パスワードが違います」
    if (password === '') {
      setDialogError(DELETE_MESSAGES.wrongPassword);
      passwordInputRef.current?.focus();
      return;
    }
    setBusyState(true);

    // ブラウザで再認証し、ID token を取り直す（api() が currentUser.getIdToken() で新しい token を使う）
    const current = getFirebaseAuth().currentUser;
    if (!current || !current.email) {
      showFailure();
      return;
    }
    try {
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
    } catch (error) {
      if (reauthFailureOf(error) === 'wrongPassword') {
        setBusyState(false);
        setDialogError(DELETE_MESSAGES.wrongPassword); // 入力は残す
        passwordInputRef.current?.focus();
        return;
      }
      showFailure();
      return;
    }

    let outcome: DeleteOutcome;
    try {
      const body: DeleteAccountBody = { confirmation: DELETE_CONFIRMATION }; // 入力欄の値ではなく、決まった文字列を送る
      const data = await api<DeleteAccountResult>('/api/account', { method: 'DELETE', body, timeoutMs: DELETE_TIMEOUT_MS });
      outcome = deleteResultOf(data);
    } catch (error) {
      if (isGateError(error)) return; // 401 UNAUTHENTICATED：AuthProvider が S-02 へ移す（文は出さない）
      outcome = deleteFailureOf(error);
    }

    switch (outcome) {
      case 'deleted':
        await leave(DELETE_MESSAGES.done, true);
        return;
      case 'noResponse':
        await leave(DELETE_MESSAGES.noResponse, false);
        return;
      case 'reauthRequired':
        setBusyState(false);
        setPassword(''); // 入力欄を空にする
        setDialogError(DELETE_MESSAGES.reauthRequired);
        passwordInputRef.current?.focus();
        return;
      case 'gate':
        return;
      default:
        showFailure();
    }
  }

  function onEnter(event: KeyboardEvent<HTMLInputElement>, action: () => void) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      action();
    }
  }

  return (
    <div>
      {trigger === 'link' ? (
        <LinkButton danger className="text-sm" onClick={openDialog} disabled={disabled || busy}>
          {DELETE_MESSAGES.triggerLink}
        </LinkButton>
      ) : (
        <button type="button" className={ROW} onClick={openDialog} disabled={disabled || busy}>
          {DELETE_MESSAGES.triggerButton}
        </button>
      )}
      {entryError && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {entryError}
        </p>
      )}

      <Dialog
        open={step === 'confirm'}
        title={DELETE_MESSAGES.confirmTitle}
        onClose={closeDialog}
        initialFocusRef={confirmInputRef}
        actions={
          <>
            <Button variant="secondary" className="flex-1" onClick={closeDialog}>
              {DELETE_MESSAGES.cancel}
            </Button>
            <Button variant="danger" className="flex-1" disabled={!canNext} onClick={goNext}>
              {DELETE_MESSAGES.next}
            </Button>
          </>
        }
      >
        <p className="text-gray-500">{DELETE_MESSAGES.confirmBody}</p>
        <p className="font-bold text-red-600">{DELETE_MESSAGES.confirmWarning}</p>
        <TextField
          id={`${baseId}-confirm`}
          className="mt-4"
          label={DELETE_MESSAGES.confirmPrompt}
          placeholder={DELETE_MESSAGES.confirmPlaceholder}
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          onKeyDown={(event) => onEnter(event, goNext)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          {...{ ref: confirmInputRef }}
        />
      </Dialog>

      <Dialog
        open={step === 'password'}
        title={DELETE_MESSAGES.reauthTitle}
        onClose={closeDialog}
        closeOnEsc={!busy}
        initialFocusRef={passwordInputRef}
        actions={
          <>
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={closeDialog}>
              {DELETE_MESSAGES.cancel}
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void submit()}>
              {busy ? DELETE_MESSAGES.deleting : DELETE_MESSAGES.submit}
            </Button>
          </>
        }
      >
        <TextField
          id={`${baseId}-password`}
          type="password"
          label={DELETE_MESSAGES.reauthPrompt}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => onEnter(event, () => void submit())}
          autoComplete="current-password"
          disabled={busy}
          error={dialogError}
          {...{ ref: passwordInputRef }}
        />
      </Dialog>
    </div>
  );
}
