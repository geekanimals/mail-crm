export const metadata = { title: 'Geek CRM', robots: { index: false }, icons: { icon: '/fav.png', apple: '/fav.png' } };
export const viewport = { width: 'device-width', initialScale: 1 };

const css = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Inter, Roboto, Arial, sans-serif; font-size: 14.5px; line-height: 1.5; letter-spacing: -0.005em; color: #0e2a33; background: #f3fbfd; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
button, input, select, textarea { font: inherit; color: inherit; }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <style>{css}</style>
        {children}
      </body>
    </html>
  );
}
