import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
            <span className="text-lg font-semibold tracking-tight">
              Ninja Coach
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              AI life coach
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
