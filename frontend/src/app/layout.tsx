import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { siteConfig } from "./config/metadata";
import '../styles/index.css';

// To swap fonts, replace this import and variable:
// import { Inter } from 'next/font/google';        → current
// import { Roboto } from 'next/font/google';        → example swap
// import { Poppins } from 'next/font/google';       → example swap
// Then update the config below accordingly.
const fontSans = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: siteConfig.title,
  description: siteConfig.description,
  openGraph: {
    images: siteConfig.ogImage,
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={fontSans.className}>{children}</body>
    </html>
  );
}
