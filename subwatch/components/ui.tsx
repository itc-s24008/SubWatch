'use client';
// 画面の共通部品（全員がこの名前で使う。04-01 が作る共通ファイル）。ボタン・リンクは縦横 44px 以上
import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { ApiClientError } from '@/lib/api-client';

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

// ---- 共通の文（オフライン・一時的な障害） ----
// api() のエラーのうち、共通の文を出すものはその文を返す。合わなければ null（機能ごとの文を出す）
//   オフライン（status 0 の OFFLINE）→「オフラインです。接続を確認してください」
//   一時的な障害（503 TEMPORARILY_UNAVAILABLE・500 RESOURCE_EXHAUSTED）→「一時的に利用できません。時間をおいて再試行してください」
export function commonErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  if (error.status === 0 && error.code === 'OFFLINE') return 'オフラインです。接続を確認してください';
  if ((error.status === 503 && error.code === 'TEMPORARILY_UNAVAILABLE') || (error.status === 500 && error.code === 'RESOURCE_EXHAUSTED')) {
    return '一時的に利用できません。時間をおいて再試行してください';
  }
  return null;
}

// ---- Button ----
// props：variant（'primary' 青地に白〔既定〕／'secondary' 白地に灰の枠／'danger' 赤地に白／'dangerOutline' 白地に赤い字〔S-06 の［削除する］〕）、
//        fullWidth?、href?（指定すると next/link で画面を移るボタンになる）、ほかは <button> と同じ（type の既定は "button"）
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerOutline';
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-white',
  secondary: 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:text-gray-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300',
  dangerOutline: 'border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:text-gray-400',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  href?: string;
}

export function Button({ variant = 'primary', fullWidth = false, href, className, type = 'button', children, ...rest }: ButtonProps) {
  const classes = cx(
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-4 py-2 text-base font-bold disabled:cursor-not-allowed',
    BUTTON_STYLES[variant],
    fullWidth && 'w-full',
    className,
  );
  if (href !== undefined) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

// ---- LinkButton ----
// 見た目がリンクの <button>（押しても画面を移らないもの。S-13 の⑧）。役割は button
// props：<button> と同じ（type の既定は "button"）、danger?（赤い字）
export interface LinkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
}

export function LinkButton({ danger = false, className, type = 'button', children, ...rest }: LinkButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex min-h-11 min-w-11 items-center underline underline-offset-2 disabled:cursor-not-allowed disabled:text-gray-400',
        danger ? 'text-red-600' : 'text-brand',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---- Brand ----
// 題の上や枠の中の「SubWatch」の文字
export function Brand({ className }: { className?: string }) {
  return <p className={cx('text-sm font-bold text-brand', className)}>SubWatch</p>;
}

// ---- PageTitle ----
// 画面のタイトル（<h1>。1画面に1つだけ）。props：children、brand?（題の上に「SubWatch」を出す。S-04・S-06 など）、
// left?（題の左に置くもの。例：「戻る」）、right?（題の右に置くもの。例：通知のベル）
export function PageTitle({ children, brand = false, left, right }: { children: ReactNode; brand?: boolean; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="bg-white px-4 pb-4 pt-5">
      {brand && <Brand className="mb-1" />}
      <div className="flex min-h-11 items-center gap-2">
        {left}
        <h1 className="flex-1 text-2xl font-bold">{children}</h1>
        {right}
      </div>
    </header>
  );
}

// ---- Card ----
// 白い角丸の枠。props：children、className?、as?（'section' | 'div'。既定 'div'）
export function Card({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'section' | 'div' }) {
  const Tag = as;
  return <Tag className={cx('rounded-2xl border border-gray-200 bg-white p-4', className)}>{children}</Tag>;
}

// ---- FieldError ----
// 入力欄のすぐ下の赤字（role="alert"）。message が空なら何も出さない。id は入力欄の aria-describedby に使う
export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-red-600">
      {message}
    </p>
  );
}

// ---- TextField ----
// ラベル付きの入力欄。props：label、id、error?（あれば赤字と aria-invalid）、hint?、ほかは <input> と同じ。
// 渡された aria-describedby は消さずに、エラーの id（`${id}-error`）を足す
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  id: string;
  error?: string | null;
  hint?: ReactNode;
}

export function TextField({ label, id, error, hint, className, 'aria-describedby': describedBy, ...rest }: TextFieldProps) {
  const errorId = `${id}-error`;
  const ids = [describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-bold text-gray-700">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={ids}
        aria-invalid={error ? true : undefined}
        className={cx(
          'block min-h-11 w-full rounded-xl border bg-white px-3 py-2 text-base',
          error ? 'border-red-500' : 'border-gray-300',
        )}
        {...rest}
      />
      {hint && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

// ---- Select ----
// ラベル付きの選択欄。props：label、id、options（{ value, label, disabled? }[]）、error?、ほかは <select> と同じ
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  id: string;
  options: { value: string; label: string; disabled?: boolean }[];
  error?: string | null;
}

export function Select({ label, id, options, error, className, 'aria-describedby': describedBy, ...rest }: SelectProps) {
  const errorId = `${id}-error`;
  const ids = [describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-bold text-gray-700">
        {label}
      </label>
      <select
        id={id}
        aria-describedby={ids}
        aria-invalid={error ? true : undefined}
        className={cx('block min-h-11 w-full rounded-xl border bg-white px-3 py-2 text-base', error ? 'border-red-500' : 'border-gray-300')}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

// ---- Switch ----
// 切替（role="switch"）。props：checked、onChange(next)、label、description?、disabled?、id?
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const labelId = id ? `${id}-label` : undefined;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <p id={labelId} className="font-bold">
          {label}
        </p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-11 w-20 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-gray-300',
        )}
      >
        <span className={cx('inline-block h-9 w-9 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-10' : 'translate-x-1')} />
      </button>
    </div>
  );
}

// ---- RadioGroup ----
// ラジオボタンの組。props：name、legend、options（{ value, label, disabled?, description? }[]）、value、onChange(value)、error?、disabled?
export function RadioGroup({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  disabled = false,
}: {
  name: string;
  legend: ReactNode;
  options: { value: string; label: ReactNode; disabled?: boolean; description?: ReactNode }[];
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1 text-sm font-bold text-gray-700">{legend}</legend>
      <div className="flex flex-col gap-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cx('flex min-h-11 items-center gap-2', (disabled || option.disabled) && 'text-gray-400')}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled || option.disabled}
              onChange={() => onChange(option.value)}
              className="h-5 w-5"
            />
            <span>
              {option.label}
              {option.description && <span className="block text-sm text-gray-500">{option.description}</span>}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

// ---- Checkbox ----
// 同意のチェック欄（S-01・S-13 で同じ部品）。props：id、checked、onChange(next)、children（ラベル。文の中のリンクを入れてよい）、disabled?
export function Checkbox({
  id,
  checked,
  onChange,
  children,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-6 w-6 shrink-0"
      />
      <label htmlFor={id} className="text-sm">
        {children}
      </label>
    </div>
  );
}

// ---- Loading ----
// 「読み込み中…」。props：text?（既定「読み込み中…」。例「保存中…」）
export function Loading({ text = '読み込み中…' }: { text?: string }) {
  return (
    <p role="status" className="p-4 text-center text-gray-500">
      {text}
    </p>
  );
}

// ---- LoadError ----
// 読み込み失敗の表示と［再試行］。props：error?（api() のエラー。共通の文〔オフライン・一時的な障害〕を優先する）、
// message?（機能ごとの文。例「請求予定を読み込めませんでした。もう一度お試しください」）、onRetry?（無ければ［再試行］を出さない）
// どちらも無いときは、見出し「読み込めませんでした」と「もう一度お試しください」
export function LoadError({ error, message, onRetry }: { error?: unknown; message?: string; onRetry?: () => void }) {
  const common = commonErrorMessage(error);
  return (
    <div role="alert" className="p-4 text-center">
      {common ? (
        <p>{common}</p>
      ) : message ? (
        <p>{message}</p>
      ) : (
        <>
          <p className="font-bold">読み込めませんでした</p>
          <p>もう一度お試しください</p>
        </>
      )}
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          再試行
        </Button>
      )}
    </div>
  );
}

// ---- EmptyState ----
// 0件のときの表示。props：title、description?、action?（ボタンなど）
export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="p-6 text-center">
      <p className="font-bold">{title}</p>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
