# Nexa chat UI

A Next.js chatbox for the NestJS AI chatbot API. It supports provider streaming,
image prompts, conversation grouping, token usage, and the backend's optional
calculator, web search, currency, date/time, and unit tools.

## Run locally

1. Start the NestJS API from the sibling `ai-chatbot` project.
2. Copy `.env.example` to `.env.local` and set `CHAT_BACKEND_URL` if the API is
   not running at `http://localhost:3000`.
3. Run:

```bash
npm run dev
```

Open `http://localhost:3001` (or the port shown by Next.js). The UI uses a
Next.js server route to proxy the Nest API, so browser CORS configuration is not
needed.

Text responses stream from `/chat/stream`. Turn on **Tools** in the composer to
use the tool-enabled `/chat` endpoint; tool calls currently return as a complete
response rather than streaming token by token. Attach one PNG, JPEG, or WebP
image up to 8 MB for vision prompts.
