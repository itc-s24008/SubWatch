// route の共通処理（機能設計書「API共通仕様」）。route.ts はこの関数で包む
//   export const POST = withApi(async (req) => { ...; return ok(data, 201); });
//   :id のある route は withApi<{ id: string }>(async (req, { params }) => { const { id } = await params; ... })
import { randomUUID } from 'node:crypto';
import { ERROR_MESSAGES, HttpError, fromFirestoreError } from '@/lib/errors';
import type { ApiFieldError } from '@/lib/types';

export interface RouteContext<P> {
  params: Promise<P>;
}

type Handler<P> = (req: Request, ctx: RouteContext<P>) => Promise<Response>;

const BODY_LIMIT_BYTES = 100 * 1024; // 100KB は 100×1024 バイト（API共通仕様 B59）

function newRequestId(): string {
  return randomUUID();
}

// 成功：{ data, error: null, requestId }。requestId はここで付ける
export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data, error: null, requestId: newRequestId() }, { status });
}

// 204（ボディなし）
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

function errorResponse(error: HttpError): Response {
  const requestId = newRequestId();
  const body: Record<string, unknown> = { code: error.code, message: error.message };
  if (error.extras.field !== undefined) body.field = error.extras.field;
  if (error.extras.details !== undefined) body.details = error.extras.details;
  if (error.extras.candidates !== undefined) body.candidates = error.extras.candidates;
  if (error.status >= 500) {
    // 5xx だけを出す。出すのは requestId・code・HTTP ステータスだけ（メール・メモ・ID token・購読の情報は出さない。API共通仕様 B22）
    console.error(JSON.stringify({ requestId, code: error.code, status: error.status }));
  }
  return Response.json({ data: null, error: body, requestId }, { status: error.status });
}

// route を包み、投げられたエラーを API共通仕様の形にする（HttpError 以外は fromFirestoreError で変える）
export function withApi<P = Record<string, string>>(handler: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      const httpError = fromFirestoreError(error);
      if (httpError.status >= 500 && process.env.NODE_ENV !== 'production' && !(error instanceof HttpError)) {
        // 開発中だけ、元のエラーも出す（本番では出さない）
        console.error(error);
      }
      return errorResponse(httpError);
    }
  };
}

function validationError(message = ERROR_MESSAGES.VALIDATION_ERROR): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message);
}

// 本文を読む（API共通仕様 B8・B59）：Content-Type（application/json。charset などの付いたものも可）→ サイズ（100KB）→ 空 → JSON・UTF-8 → オブジェクトか
// どれかに合わなければ 400 VALIDATION_ERROR（大きすぎるときの message は「入力内容が大きすぎます」）
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') ?? '';
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw validationError();

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES) throw validationError('入力内容が大きすぎます');

  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > BODY_LIMIT_BYTES) throw validationError('入力内容が大きすぎます');
  if (buffer.byteLength === 0) throw validationError();

  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    parsed = JSON.parse(text);
  } catch {
    throw validationError();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw validationError();
  return parsed as Record<string, unknown>;
}

// 未知のキーを拒否する（API共通仕様 B5・B68）。複数あるときはすべて details に入れ、field は本文の順で最初のキー
// prefix は入れ子のキー（例 'keys.'）のとき field の前に付ける
export function rejectUnknownKeys(body: Record<string, unknown>, allowed: readonly string[], prefix = ''): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((key) => !allowedSet.has(key));
  if (unknown.length === 0) return;
  const details: ApiFieldError[] = unknown.map((key) => ({
    field: `${prefix}${key}`,
    code: 'UNKNOWN_FIELD',
    message: ERROR_MESSAGES.UNKNOWN_FIELD,
  }));
  throw new HttpError(400, 'UNKNOWN_FIELD', undefined, { field: details[0].field, details });
}
