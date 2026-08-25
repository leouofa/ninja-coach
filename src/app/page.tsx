export default function Home() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Welcome to Ninja Coach
      </h1>
      <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        Weekly check-ins on what you&apos;re doing, where you&apos;re going,
        and the progress you&apos;ve made.
      </p>
    </section>
  );
}
