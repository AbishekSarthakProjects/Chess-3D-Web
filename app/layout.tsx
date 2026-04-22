import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skyboard",
  description: "Play chess with hand gestures. Developed by Abishek Mohan and Sarthak bagal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-[#050505] text-white">{children}</body>
    </html>
  );
}
