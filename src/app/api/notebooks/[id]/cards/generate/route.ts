import { getDb } from '@/lib/db';
import { cardsGenerate, type CardsGenerateEvent } from '@/lib/server/cards';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = (await ctx.params).id;
  // Plain JSON for callers that do not ask for progress.
  if (!req.headers.get('accept')?.includes('application/x-ndjson')) {
    return cardsGenerate(getDb(), req, id);
  }

  const db = getDb();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CardsGenerateEvent | Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const res = await cardsGenerate(db, req, id, { onEvent: send as (event: CardsGenerateEvent) => void });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          send({
            type: 'error',
            status: res.status,
            error: body.error ?? `Request failed: ${res.status}`,
            code: body.code,
            retryAfter: res.headers.get('retry-after')
          });
        } else {
          // The `done` event already carried the drafts; drain the response.
          await res.text();
        }
      } catch {
        send({ type: 'error', status: 500, error: 'Card generation failed — try again.' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no'
    }
  });
};
