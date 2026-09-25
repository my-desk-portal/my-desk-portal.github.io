import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Desk",
  description: "Permit slip registration and management",
  icons: { icon: "/my%20desk%20logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
