import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BrainFlow - 视频内容智能中枢",
  description: "集成视频解析、音频转录、智能笔记的知识内化工具",
  referrer: "no-referrer", // Bypass 403 Forbidden on Bilibili hotlinked images
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        <TooltipProvider>{children}</TooltipProvider>
        <Script src="/tools/analytics-center/tracker.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
