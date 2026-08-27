import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { GoalsSidebar } from "@/components/goals-sidebar";
import { SessionsSidebar } from "@/components/sessions-sidebar";
import { TodosSidebar } from "@/components/todos-sidebar";
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
      <body className="flex min-h-dvh flex-col bg-background text-foreground">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800 lg:hidden">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Ninja Coach
          </Link>
          <nav className="flex shrink-0 items-center gap-2">
            <Link
              href="/new"
              className="rounded-xl bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              New chat
            </Link>
            <Link
              href="/checkin"
              className="rounded-xl border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Check-in
            </Link>
          </nav>
        </div>
        <div className="flex min-h-0 flex-1">
          <SessionsSidebar />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
          <aside className="hidden w-64 shrink-0 space-y-4 py-8 pr-6 xl:block">
            <GoalsSidebar />
            <TodosSidebar />
          </aside>
        </div>
      </body>
    </html>
  );
}