'use client';
// S-05 サブスク登録・編集のフォーム（04-06。編集は 04-08 が使う）。画面設計書 2.画面詳細(S-05)・状態・ダイアログ一覧の S-05 の行、
// 機能設計書 詳細_F-03・詳細_F-08 のとおり
//
// props：{ mode: 'new' } | { mode: 'edit'; subscription: SubscriptionDto }
//   保存（新規は POST、編集は PATCH）と、保存の後の移動は、このフォームの中で行う（ページは読んだ値を渡すだけ）
//   - 新規の保存の後：S-05 を S-06 に置き換える（router.replace）
//   - 編集の保存の後と、変更が無いとき：履歴の1つ前がそのサブスクの S-06 なら router.back()。そうでないとき
//     （URL を直接開いたときなど）と、Navigation API が使えないブラウザでは、S-06 に置き換える（⑱）
//   - ［キャンセル］と左上の「戻る」：前の画面へ戻る。戻る先が無ければ、新規は S-04、編集は S-06 へ置き換える（⑰）。
//     保存中も押せ、押した後に保存が成功しても移動しない
// SubscriptionFormTitle：題と「戻る」（編集のページが、読み込み中・読み込み失敗・「見つかりません」のときにも使う）
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';
import { IconBadge } from '@/components/IconBadge';
import { Button, Card, FieldError, LinkButton, PageTitle, RadioGroup, Select, Switch, TextField, commonErrorMessage } from '@/components/ui';
import { ApiClientError, api, isGateError } from '@/lib/api-client';
import { todayJST } from '@/lib/clock';
import { BILLING_CYCLE_LABELS, CATEGORY_LABELS } from '@/lib/format';
import {
  BILLING_CYCLE_OPTIONS,
  CATEGORY_OPTIONS,
  FORM_FIELDS,
  canChooseEndOfMonth,
  initialFormValues,
  nextBillingPreview,
  toCreateBody,
  toFormValues,
  toUpdateBody,
  validateForm,
  type FormErrors,
  type FormField,
  type FormValues,
} from '@/lib/subscription-form';
import type { SubscriptionDto, SubscriptionResponse } from '@/lib/types';

export type SubscriptionFormProps = { mode: 'new' } | { mode: 'edit'; subscription: SubscriptionDto };

type AppRouter = ReturnType<typeof useRouter>;

const SAVE_FAILED = '保存できませんでした。もう一度お試しください';
const LIMIT_REACHED = '登録できるサブスクは200件までです';
const NOT_FOUND = 'サブスクが見つかりません';

// 欄の下にエラーを出せない項目（切替）。API がこの項目だけの 400 を返したときは「保存できませんでした…」
const FIELDS_WITHOUT_ERROR_TEXT: readonly FormField[] = ['trialEnabled', 'subscriptionNotificationEnabled'];

function detailPath(id: string): string {
  return `/subscriptions/${encodeURIComponent(id)}`;
}

// 前の画面へ戻る（戻る先が無いときは fallback へ置き換える）
export function goBackOr(router: AppRouter, fallback: string): void {
  if (window.history.length > 1) router.back();
  else router.replace(fallback);
}

// 履歴の1つ前が、そのサブスクの S-06 か（Navigation API で調べる。使えないブラウザでは false）
interface NavigationLike {
  currentEntry?: { index: number } | null;
  entries?: () => { url: string | null }[];
}
function previousEntryIsDetail(id: string): boolean {
  try {
    const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
    if (!navigation?.currentEntry || typeof navigation.entries !== 'function') return false;
    const index = navigation.currentEntry.index;
    if (index < 1) return false;
    const previous = navigation.entries()[index - 1];
    if (!previous?.url) return false;
    const url = new URL(previous.url);
    return url.origin === window.location.origin && url.pathname === detailPath(id);
  } catch {
    return false;
  }
}

// 題（①）と、左上の「戻る」
export function SubscriptionFormTitle({ mode, onBack }: { mode: 'new' | 'edit'; onBack: () => void }) {
  return (
    <PageTitle
      left={
        <LinkButton onClick={onBack} className="-ml-2 px-2 font-bold no-underline">
          <span aria-hidden="true">‹&nbsp;</span>戻る
        </LinkButton>
      }
    >
      {mode === 'new' ? 'サブスクを追加' : 'サブスクを編集'}
    </PageTitle>
  );
}

function Required() {
  return <span aria-hidden="true"> *</span>;
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  if (!htmlFor) return <p className="mb-1 block text-sm font-bold text-gray-700">{children}</p>;
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-bold text-gray-700">
      {children}
    </label>
  );
}

export function SubscriptionForm(props: SubscriptionFormProps) {
  const router = useRouter();
  const subscription = props.mode === 'edit' ? props.subscription : null;
  const subscriptionId = subscription?.subscriptionId ?? null;
  const fallback = subscriptionId ? detailPath(subscriptionId) : '/subscriptions';

  const [values, setValues] = useState<FormValues>(() => (subscription ? toFormValues(subscription) : initialFormValues()));
  const [touched, setTouched] = useState<Set<FormField>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const savingRef = useRef(false); // 連打で2件にしないため（state の反映を待たずに止める）
  const leftRef = useRef(false); // キャンセル・戻るを押した後か、画面を離れた後（保存が成功しても移動しない）

  useEffect(() => {
    leftRef.current = false;
    return () => {
      leftRef.current = true;
    };
  }, []);

  const clientErrors = useMemo(() => validateForm(values), [values]);
  const shownErrors: FormErrors = {};
  for (const key of FORM_FIELDS) {
    const client = submitted || touched.has(key) ? clientErrors[key] : undefined;
    const message = client ?? serverErrors[key];
    if (message) shownErrors[key] = message;
  }
  const hasShownErrors = Object.keys(shownErrors).length > 0;
  const saveDisabled = saving || (submitted && hasShownErrors);
  const endOfMonthChoosable = canChooseEndOfMonth(values.firstBillingDate);
  const preview = nextBillingPreview(values, todayJST());

  function update<K extends FormField>(key: K, value: FormValues[K]) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      // ⑥が月末日でなくなったら「請求日と同じ日」に戻す（⑦）
      if (key === 'firstBillingDate' && next.billingDayMode === 'endOfMonth' && !canChooseEndOfMonth(next.firstBillingDate)) {
        next.billingDayMode = 'fixedDay';
      }
      return next;
    });
    setServerErrors((previous) => {
      if (!previous[key] && !(key === 'firstBillingDate' && previous.billingDayMode)) return previous;
      const next = { ...previous };
      delete next[key];
      if (key === 'firstBillingDate') delete next.billingDayMode; // 請求日方式のエラーは、請求日か請求日方式を変えると消える
      return next;
    });
  }

  function touch(key: FormField) {
    setTouched((previous) => (previous.has(key) ? previous : new Set(previous).add(key)));
  }

  function leave() {
    leftRef.current = true;
    goBackOr(router, fallback);
  }

  function goToDetailAfterEdit(id: string) {
    if (previousEntryIsDetail(id)) router.back();
    else router.replace(detailPath(id));
  }

  function focusFirstError(errors: FormErrors) {
    const first = FORM_FIELDS.find((key) => errors[key]);
    if (!first) return;
    const element = document.getElementById(first) ?? document.querySelector<HTMLElement>(`input[name="${first}"]:not([disabled])`);
    element?.focus();
  }

  function showSaveError(error: unknown) {
    if (error instanceof ApiClientError) {
      if (error.status === 409 && error.code === 'DUPLICATE_CANDIDATE' && props.mode === 'new') {
        setDuplicateName(values.serviceName.trim());
        return;
      }
      if (error.status === 409 && error.code === 'SUBSCRIPTION_LIMIT_REACHED') {
        setFormMessage(LIMIT_REACHED);
        return;
      }
      if (error.status === 404 && props.mode === 'edit') {
        setFormMessage(NOT_FOUND);
        return;
      }
      if (error.status === 400) {
        // details の各 message を、その field の欄の下に出す。欄の無い field だけのときは「保存できませんでした…」
        const details = error.details ?? (error.field ? [{ field: error.field, code: error.code, message: error.message }] : []);
        const mapped: FormErrors = {};
        for (const detail of details) {
          const field = detail.field as FormField;
          if (FORM_FIELDS.includes(field) && !FIELDS_WITHOUT_ERROR_TEXT.includes(field) && !mapped[field]) mapped[field] = detail.message;
        }
        if (Object.keys(mapped).length > 0) {
          setServerErrors(mapped);
          focusFirstError(mapped);
          return;
        }
      }
    }
    // オフライン・一時的な障害は共通の文を優先する。CONFLICT・通信の失敗などは「保存できませんでした…」（API の message は出さない）
    setFormMessage(commonErrorMessage(error) ?? SAVE_FAILED);
  }

  async function save(confirmDuplicate: boolean) {
    if (savingRef.current) return;
    setSubmitted(true);
    const errors = validateForm(values);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors);
      return; // API は呼ばない
    }
    if (Object.keys(serverErrors).length > 0) return; // API のエラーが残っている間は押せない

    savingRef.current = true;
    setSaving(true);
    setFormMessage(null);
    let succeeded = false;
    try {
      if (props.mode === 'new') {
        const body = toCreateBody(values);
        const result = await api<SubscriptionResponse>('/api/subscriptions', {
          method: 'POST',
          // confirmDuplicate は、警告ダイアログの［登録する］で送り直すときだけ付ける（ほかのときはキーごと送らない）
          body: confirmDuplicate ? { ...body, confirmDuplicate: true } : body,
        });
        succeeded = true;
        if (!leftRef.current) router.replace(detailPath(result.subscription.subscriptionId));
      } else {
        const id = props.subscription.subscriptionId;
        const body = toUpdateBody(props.subscription, values);
        if (Object.keys(body).length > 0) {
          await api<SubscriptionResponse>(`/api/subscriptions/${encodeURIComponent(id)}`, { method: 'PATCH', body });
        }
        succeeded = true;
        if (!leftRef.current) goToDetailAfterEdit(id);
      }
    } catch (error) {
      if (isGateError(error)) return;
      showSaveError(error);
    } finally {
      if (!succeeded) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  function textField(
    key: 'planName' | 'price' | 'firstBillingDate' | 'websiteUrl' | 'cancelUrl' | 'paymentMethod' | 'trialEndDate',
    label: ReactNode,
    extra: { type?: string; inputMode?: 'numeric'; placeholder?: string; min?: string; max?: string; required?: boolean } = {},
  ) {
    const { required, ...inputProps } = extra;
    return (
      <TextField
        id={key}
        name={key}
        label={label}
        value={values[key]}
        error={shownErrors[key]}
        aria-required={required ? true : undefined}
        onChange={(event) => update(key, event.target.value)}
        onBlur={() => touch(key)}
        className="min-w-0"
        {...inputProps}
      />
    );
  }

  return (
    <>
      <SubscriptionFormTitle mode={props.mode} onBack={leave} />
      <main className="p-4">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveDisabled) void save(false);
          }}
        >
          {/* ② サービス名（F-13 の候補と「公式サイトのURLを入れると…」は 05-07。アイコンは IconBadge〔頭文字〕） */}
          <div>
            <FieldLabel htmlFor="serviceName">
              サービス名
              <Required />
            </FieldLabel>
            <div
              className={`flex min-h-14 items-center gap-3 rounded-xl border bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-brand ${
                shownErrors.serviceName ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <IconBadge serviceName={values.serviceName} websiteUrl={values.websiteUrl || null} />
              <input
                id="serviceName"
                name="serviceName"
                value={values.serviceName}
                aria-required="true"
                aria-invalid={shownErrors.serviceName ? true : undefined}
                aria-describedby={shownErrors.serviceName ? 'serviceName-error' : undefined}
                onChange={(event) => update('serviceName', event.target.value)}
                onBlur={() => touch('serviceName')}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-base font-bold outline-none"
              />
            </div>
            <FieldError id="serviceName-error" message={shownErrors.serviceName} />
          </div>

          {/* ③ プラン名・④ 1回の請求額 */}
          <div className="grid grid-cols-2 gap-3">
            {textField('planName', 'プラン名')}
            {textField(
              'price',
              <>
                1回の請求額（円）
                <Required />
              </>,
              { inputMode: 'numeric', required: true },
            )}
          </div>

          {/* ⑤ 請求周期 */}
          <Select
            id="billingCycle"
            name="billingCycle"
            label={
              <>
                請求周期
                <Required />
              </>
            }
            aria-required="true"
            value={values.billingCycle}
            error={shownErrors.billingCycle}
            options={[{ value: '', label: '選択してください' }, ...BILLING_CYCLE_OPTIONS.map((value) => ({ value, label: BILLING_CYCLE_LABELS[value] }))]}
            onChange={(event) => update('billingCycle', event.target.value as FormValues['billingCycle'])}
            onBlur={() => touch('billingCycle')}
          />

          {/* ⑥ 請求日 */}
          {textField(
            'firstBillingDate',
            <>
              請求日（過去に請求された日、または次の請求日）
              <Required />
            </>,
            { type: 'date', min: '2000-01-01', max: '2100-12-31', required: true },
          )}

          {/* ⑦ 請求日方式 */}
          <div>
            <RadioGroup
              name="billingDayMode"
              legend={
                <>
                  請求日方式
                  <Required />
                </>
              }
              value={values.billingDayMode}
              error={shownErrors.billingDayMode}
              onChange={(value) => update('billingDayMode', value as FormValues['billingDayMode'])}
              options={[
                { value: 'fixedDay', label: '請求日と同じ日' },
                { value: 'endOfMonth', label: endOfMonthChoosable ? '毎月末日' : '毎月末日（選択不可）', disabled: !endOfMonthChoosable },
              ]}
            />
            <p className="mt-1 text-sm text-gray-500">※ 月末日以外の請求日は「毎月末日」を選択できません</p>
          </div>

          {/* ⑧ 次回請求日（自動計算・編集不可） */}
          <div>
            <FieldLabel>次回請求日（自動計算・編集不可）</FieldLabel>
            <p className="rounded-xl bg-brand-light px-4 py-3 text-lg font-bold" data-testid="next-billing-preview">
              {preview}
            </p>
            <p className="mt-1 text-sm text-gray-500">保存後はサーバー側の計算結果を表示します</p>
          </div>

          {/* ⑨ カテゴリー */}
          <Select
            id="category"
            name="category"
            label={
              <>
                カテゴリー
                <Required />
              </>
            }
            aria-required="true"
            value={values.category}
            error={shownErrors.category}
            options={CATEGORY_OPTIONS.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
            onChange={(event) => update('category', event.target.value as FormValues['category'])}
            onBlur={() => touch('category')}
          />

          {/* ⑩ 無料トライアル・⑪ トライアル最終無料日 */}
          <div className="flex flex-col gap-3">
            <div>
              <FieldLabel>無料トライアル</FieldLabel>
              <div className="rounded-xl border border-gray-300 bg-white px-4 py-1">
                <Switch
                  id="trialEnabled"
                  checked={values.trialEnabled}
                  onChange={(next) => update('trialEnabled', next)}
                  label={values.trialEnabled ? 'ON（トライアル中）' : 'OFF（トライアル中の場合はON）'}
                />
              </div>
            </div>
            {values.trialEnabled &&
              textField('trialEndDate', 'トライアル最終無料日（ONの場合は必須）', {
                type: 'date',
                min: '2000-01-01',
                max: '2100-12-31',
                required: true,
              })}
          </div>

          {/* ⑫ 公式サイトURL・⑬ 解約URL */}
          <div className="grid grid-cols-2 gap-3">
            {textField('websiteUrl', '公式サイトURL（任意）', { type: 'url', placeholder: '未入力' })}
            {textField('cancelUrl', '解約URL（任意）', { type: 'url', placeholder: '未入力' })}
          </div>

          {/* ⑭ 支払方法の表示名 */}
          {textField('paymentMethod', '支払方法の表示名（任意）')}

          {/* ⑮ メモ */}
          <div>
            <FieldLabel htmlFor="memo">メモ（任意・最大1000文字）</FieldLabel>
            <textarea
              id="memo"
              name="memo"
              rows={3}
              value={values.memo}
              aria-invalid={shownErrors.memo ? true : undefined}
              aria-describedby={shownErrors.memo ? 'memo-error' : undefined}
              onChange={(event) => update('memo', event.target.value)}
              onBlur={() => touch('memo')}
              className={`block w-full rounded-xl border bg-white px-3 py-2 text-base ${shownErrors.memo ? 'border-red-500' : 'border-gray-300'}`}
            />
            <FieldError id="memo-error" message={shownErrors.memo} />
          </div>

          {/* ⑯ このサブスクの通知 */}
          <Card>
            <Switch
              id="subscriptionNotificationEnabled"
              checked={values.subscriptionNotificationEnabled}
              onChange={(next) => update('subscriptionNotificationEnabled', next)}
              label="このサブスクの通知を有効にする"
              description="通知は請求日・最終無料日の7日前と1日前。毎日、日本時間9時台（遅れると11時台か18時台）に判定します。その日の判定より後に登録した分は、次の送信日から通知します"
            />
          </Card>

          {/* ⑰ キャンセル・⑱ 保存する */}
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-500">入力内容を確認して保存します。</p>
            {formMessage && (
              <p role="alert" className="text-sm text-red-600">
                {formMessage}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={leave}>
                キャンセル
              </Button>
              <Button type="submit" disabled={saveDisabled}>
                {saving ? '保存中…' : '保存する'}
              </Button>
            </div>
            {props.mode === 'new' && (
              <Card>
                <p className="text-sm text-gray-500">同じサービス名で登録済みの場合は、保存前に確認ダイアログを表示します。</p>
                <p className="text-sm text-gray-500">登録上限は200件です。</p>
              </Card>
            )}
          </div>
        </form>
      </main>

      {/* 409 DUPLICATE_CANDIDATE の警告ダイアログ（F-10） */}
      <Dialog
        open={duplicateName !== null}
        title={`『${duplicateName ?? ''}』はすでに登録されています。`}
        onClose={() => setDuplicateName(null)}
        actions={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setDuplicateName(null)}>
              戻る
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setDuplicateName(null);
                void save(true);
              }}
            >
              登録する
            </Button>
          </>
        }
      >
        <p className="text-gray-500">別の契約として登録しますか？</p>
      </Dialog>
    </>
  );
}
