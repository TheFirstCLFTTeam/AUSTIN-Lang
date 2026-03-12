import React from 'react';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="%PUBLIC_URL%/head.png" />
        <meta name="theme-color" content="#000000" />
        <meta
          name="description"
          content="Web site created using create-react-app"
        />
        <link rel="icon" href="%PUBLIC_URL%/logo.png" />

        <link rel="manifest" href="%PUBLIC_URL%/manifest.json" />

        <title>AUSTIN-Lang</title>
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>

  );
}