import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Strata',
    template: '%s · Strata',
  },
  description:
    'Structured work management: custom item types, nested hierarchies, category trees, and a spreadsheet-grade grid.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The grid needs pinch-zoom on tablets; disabling it is an accessibility
  // failure, not a polish decision.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
