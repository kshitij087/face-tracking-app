import './globals.css'; // Keep your global CSS import
import { Inter } from 'next/font/google'; // Import Inter font from next/font
import Script from 'next/script'; // Import Next.js Script component

// Initialize Inter font
const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Face Tracking & Recording App',
  description: 'A real-time face tracking and video recording application.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Tailwind CSS CDN - Use Next.js Script component */}
        <Script
          src="https://cdn.tailwindcss.com"
          strategy="beforeInteractive" // Load before React hydration
          key="tailwind-cdn"
        />
        {/* Google Fonts link for Inter - Handled by next/font/google */}
        {/* Face-API.js CDN - Use Next.js Script component */}
        <Script
          src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"
          strategy="beforeInteractive" // Load before React hydration
          key="faceapi-cdn"
        />
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}