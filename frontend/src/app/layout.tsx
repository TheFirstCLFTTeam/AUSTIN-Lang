import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { siteConfig } from "./config/metadata";
import '../index.css';

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
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}