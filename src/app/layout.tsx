import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Inspect | Website QA Dashboard',
  description: 'Track website checks, compare scan history, and turn findings into assigned work.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
