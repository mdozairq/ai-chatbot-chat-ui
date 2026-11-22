export async function POST(request: Request) {
  const backendUrl = (
    process.env.CHAT_BACKEND_URL || 'http://localhost:3000'
  ).replace(/\/+$/, '');

  try {
    const upstream = await fetch(`${backendUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
      cache: 'no-store',
      signal: request.signal,
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backend unavailable';
    return Response.json({ error: message }, { status: 502 });
  }
}
