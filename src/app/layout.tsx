import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexa — AI workspace",
  description: "A streaming chat interface for your AI assistant.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
