import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Ninja Coach",
    template: "%s | Ninja Coach",
  },
  description: "Your AI life coach — weekly check-ins on goals and progress.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 py-4">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Ninja Coach
            </Link>
            <nav className="flex shrink-0 items-center gap-2">
              <Link
                href="/new"
                className="rounded-xl px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                New chat
              </Link>
              <Link
                href="/checkin"
                className="rounded-xl border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Weekly check-in
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
