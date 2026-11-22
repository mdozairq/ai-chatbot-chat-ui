export async function POST(request: Request) {
  const backendUrl = (
    process.env.CHAT_BACKEND_URL || 'http://localhost:3000'
  ).replace(/\/+$/, '');

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
      cache: 'no-store',
      signal: request.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backend unavailable';
    return Response.json({ error: message }, { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
