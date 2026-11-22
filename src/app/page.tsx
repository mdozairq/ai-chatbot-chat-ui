"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  error?: boolean;
};

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; requestId: string; conversationId: string; model: string; usage: { totalTokens: number } }
  | { type: "error"; message: string };

type CompleteResult = {
  reply?: string;
  model?: string;
  conversationId?: string;
  usage?: { totalTokens?: number };
};

const starterPrompts = [
  "Summarize the main ideas in a clear way",
  "Explain a difficult topic with a simple example",
  "Help me think through a problem step by step",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [useTools, setUseTools] = useState(false);
  const [usageLabel, setUsageLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    function onShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        controllerRef.current?.abort();
        controllerRef.current = null;
        setMessages([]);
        setInput("");
        setImage(null);
        setConversationId(undefined);
        setUsageLabel("");
        setNotice("");
        setIsLoading(false);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  function updateMessage(id: string, update: (message: Message) => Message) {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message));
  }

  function resetChat() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMessages([]);
    setInput("");
    setImage(null);
    setConversationId(undefined);
    setUsageLabel("");
    setNotice("");
    setIsLoading(false);
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
      setNotice("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNotice("Images must be 8 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImage({ name: file.name, dataUrl: reader.result });
        setNotice("");
      }
    };
    reader.onerror = () => setNotice("Could not read that image. Try another file.");
    reader.readAsDataURL(file);
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const prompt = input.trim();
    if ((!prompt && !image) || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt || "What is in this image?",
      image: image?.dataUrl,
    };
    const assistantId = crypto.randomUUID();
    const imageDataUrl = image?.dataUrl;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setImage(null);
    setNotice("");
    setUsageLabel("");
    setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const controller = new AbortController();
    controllerRef.current = controller;
    let fullReply = "";
    let receivedDone = false;
    let buffer = "";

    const handleBlock = (block: string) => {
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) return;
      const payload = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
      if (payload.type === "delta") {
        fullReply += payload.text;
        updateMessage(assistantId, (message) => ({ ...message, content: fullReply }));
      } else if (payload.type === "done") {
        receivedDone = true;
        setConversationId(payload.conversationId);
        setUsageLabel(`${payload.model} · ${payload.usage.totalTokens.toLocaleString()} tokens`);
      } else if (payload.type === "error") {
        throw new Error(payload.message);
      }
    };

    try {
      const response = await fetch(useTools ? "/api/chat/complete" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMessage.content,
          ...(imageDataUrl ? { images: [imageDataUrl] } : {}),
          ...(conversationId ? { conversationId } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Request failed (${response.status})`);
      }
      if (useTools) {
        const envelope = await response.json() as { data?: CompleteResult } & CompleteResult;
        const result: CompleteResult = envelope.data ?? envelope;
        fullReply = result.reply ?? "";
        updateMessage(assistantId, (message) => ({ ...message, content: fullReply }));
        if (result.conversationId) setConversationId(result.conversationId);
        setUsageLabel(`${result.model ?? "Model"} · ${(result.usage?.totalTokens ?? 0).toLocaleString()} tokens · tools`);
        receivedDone = true;
        return;
      }
      if (!response.body) throw new Error("The server did not return a stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) handleBlock(block);
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleBlock(buffer);
      if (!receivedDone) throw new Error("The response stream ended before completion.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        updateMessage(assistantId, (message) => ({ ...message, content: fullReply || "Generation stopped." }));
      } else {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        updateMessage(assistantId, (current) => ({ ...current, content: fullReply || message, error: !fullReply }));
        if (fullReply) setNotice(message);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsLoading(false);
      }
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function copyMessage(message: Message) {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 1400);
  }

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Nexa home">
          <span className="brand-mark">n</span>
          <span>nexa<span className="brand-dot">.</span></span>
        </a>
        <button className="new-chat" onClick={resetChat}>
          <span className="plus-icon">＋</span> New chat
          <span className="shortcut">⌘ K</span>
        </button>
        <div className="side-label">WORKSPACE</div>
        <div className="side-item side-item-active"><span className="side-glyph">◈</span> Assistant <span className="active-dot" /></div>
        <div className="side-label recent-label">RECENT</div>
        <div className="empty-history">Your conversations will<br />appear here.</div>
        <div className="sidebar-bottom">
          <div className="connection-indicator"><span /> Streaming API</div>
          <div className="profile-card">
            <div className="avatar">A</div>
            <div><strong>AI Workspace</strong><small>Personal assistant</small></div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>Assistant</strong></div>
          <div className="topbar-right"><span className="live-pill"><span /> LIVE</span><button className="icon-button" title="Settings" aria-label="Settings">⚙</button></div>
        </header>

        <div className="conversation" aria-live="polite">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-orb"><span>✳</span></div>
              <div className="eyebrow">YOUR AI WORKSPACE</div>
              <h1>A clear answer<br />starts with a good question.</h1>
              <p>Ask anything, explore an idea, or drop in an image to get started.</p>
              <div className="suggestions">
                {starterPrompts.map((prompt, index) => (
                  <button key={prompt} className="suggestion" onClick={() => setInput(prompt)}>
                    <span className={`suggestion-icon suggestion-${index}`}>{["↗", "✳", "⌘"][index]}</span>
                    <span>{prompt}</span><span className="suggestion-arrow">↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article key={message.id} className={`message-row ${message.role === "user" ? "message-user" : "message-assistant"}`}>
                  {message.role === "assistant" && <div className="message-avatar">✳</div>}
                  <div className="message-column">
                    <div className="message-author">{message.role === "user" ? "You" : "Nexa"}</div>
                    <div className={`message-bubble ${message.role === "user" ? "user-bubble" : "assistant-bubble"} ${message.error ? "error-bubble" : ""}`}>
                      {message.image && <Image className="message-image" src={message.image} alt="Uploaded attachment" width={360} height={290} unoptimized />}
                      {message.content ? <div className="message-text">{message.content}</div> : <div className="typing-dots"><span /><span /><span /></div>}
                    </div>
                    {message.role === "assistant" && message.content && !message.error && (
                      <div className="message-actions"><button onClick={() => void copyMessage(message)}>{copiedId === message.id ? "Copied ✓" : "Copy ↗"}</button></div>
                    )}
                  </div>
                </article>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <footer className="composer-area">
          {notice && <div className="notice">{notice}</div>}
          {usageLabel && <div className="usage-label">Last response · {usageLabel}</div>}
          {image && <div className="attachment-preview"><Image src={image.dataUrl} alt="Selected attachment" width={30} height={30} unoptimized /><span>{image.name}</span><button onClick={() => setImage(null)} aria-label="Remove image">×</button></div>}
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message Nexa..."
              aria-label="Message"
              disabled={isLoading}
            />
            <div className="composer-tools">
              <div className="composer-left">
                <input ref={fileRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} />
                <button type="button" className="attach-button" onClick={() => fileRef.current?.click()} disabled={isLoading} aria-label="Attach an image" title="Attach image">＋</button>
                <button type="button" className={`tool-toggle ${useTools ? "tool-toggle-on" : ""}`} onClick={() => setUseTools((enabled) => !enabled)} disabled={isLoading} title="Calculator, web search, currency and unit tools. Tool calls use complete responses instead of token streaming.">✳ Tools</button>
                <span className="composer-hint">Images up to 8 MB</span>
              </div>
              {isLoading ? (
                <button type="button" className="send-button stop-button" onClick={() => controllerRef.current?.abort()} aria-label="Stop generation" title="Stop generation">■</button>
              ) : (
                <button type="submit" className="send-button" disabled={!input.trim() && !image} aria-label="Send message" title="Send message">↑</button>
              )}
            </div>
          </form>
          <div className="composer-disclaimer">Nexa can make mistakes. Check important information.</div>
        </footer>
      </section>
    </main>
  );
}
