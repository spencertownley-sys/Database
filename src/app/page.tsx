import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/Logo";
import { LandingGridPreview } from "@/components/marketing/LandingGridPreview";
import {
  CalendarCheck,
  Link2,
  Users,
  Mic2,
  Plane,
  Music,
  Guitar,
} from "lucide-react";

const STEPS = [
  {
    icon: Link2,
    title: "Send one link",
    body: "Create a band, get a link, text it to everyone. No app to download, no account for your bandmates.",
  },
  {
    icon: CalendarCheck,
    title: "They tap their availability",
    body: "Everyone taps through a simple weekly grid — mornings, afternoons, evenings, nights — plus any specific dates they're out.",
  },
  {
    icon: Users,
    title: "You see who's free, at a glance",
    body: "One shared view shows exactly when the whole band overlaps, so you can lock in rehearsal without ten group texts.",
  },
];

const USE_CASES = [
  { icon: Guitar, label: "Weekly rehearsal" },
  { icon: Mic2, label: "Booking a gig" },
  { icon: Plane, label: "Planning a tour" },
  { icon: Music, label: "Finding a sub" },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground sm:flex">
            <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            <a href="#use-cases" className="hover:text-foreground">Use cases</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Get started free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="container py-16 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Find time to rehearse, without the group chat spiral.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Downbeat is the easiest way for a band to figure out when everyone&apos;s free. Share a
              single link — no logins, no busy Google Calendars to compare — your bandmates just
              tap when they&apos;re around.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">Start your band&apos;s link — it&apos;s free</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              No credit card. Your band members never need to sign up.
            </p>
          </div>

          <div className="mx-auto mt-14 max-w-3xl rounded-2xl border bg-card p-4 shadow-xl sm:p-8">
            <LandingGridPreview />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t bg-secondary/40 py-20">
          <div className="container">
            <h2 className="text-center text-3xl font-bold tracking-tight">How it works</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
              Built for the person in the band who has trouble logging into anything — because
              nobody but you has to log in at all.
            </p>
            <div className="mt-14 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <div key={step.title} className="relative rounded-xl border bg-card p-6">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
                    Step {i + 1}
                  </p>
                  <h3 className="mb-2 font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" className="py-20">
          <div className="container">
            <h2 className="text-center text-3xl font-bold tracking-tight">
              Made for bands, not corporate calendars
            </h2>
            <div className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
              {USE_CASES.map((uc) => (
                <div
                  key={uc.label}
                  className="flex flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center"
                >
                  <uc.icon className="h-6 w-6 text-primary" />
                  <span className="text-sm font-medium">{uc.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t bg-secondary/40 py-20">
          <div className="container">
            <h2 className="text-center text-3xl font-bold tracking-tight">Simple pricing</h2>
            <div className="mx-auto mt-10 max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">Free</p>
              <p className="mt-2 text-4xl font-bold">$0</p>
              <p className="mt-1 text-sm text-muted-foreground">for your whole band, forever</p>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                <li>Unlimited bands and members</li>
                <li>Weekly &amp; date-specific availability</li>
                <li>One link — no logins for members</li>
              </ul>
              <Button className="mt-6 w-full" asChild>
                <Link href="/signup">Get started free</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-10">
        <div className="container flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <Logo />
          <p>&copy; {new Date().getFullYear()} Downbeat. Made for bands with busy lives.</p>
        </div>
      </footer>
    </div>
  );
}
