import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "صندوق السوشيال",
  description: "لوحة إدارة مالية داخلية للشركة",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="h-full" suppressHydrationWarning>
      <body className="min-h-full bg-stone-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
