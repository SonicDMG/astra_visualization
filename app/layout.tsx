import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Astra Data Explorer',
  description: 'Explore your DataStax Astra DB data',
};

// Runs before first paint: applies the saved theme (default dark) to avoid a flash.
const themeInitScript = `try{if(localStorage.getItem('astra-theme')==='light')document.documentElement.classList.add('light')}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
