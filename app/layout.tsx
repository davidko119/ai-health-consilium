import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConvexProviderBoundary } from "@/components/ConvexProviderBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Health Consilium",
  description: "A multi-agent biomedical research gap discovery workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider>
          <ConvexProviderBoundary>{children}</ConvexProviderBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
