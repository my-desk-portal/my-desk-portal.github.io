import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://my-desk-portal.github.io"),
  title: "My Desk",
  description: "where your docs meet automation",
  icons: { icon: "/my%20desk%20logo.png" },
  openGraph: {
    title: "My Desk",
    description: "where your docs meet automation",
    url: "/",
    siteName: "My Desk",
    images: [{ url: "/share-image.png", alt: "My Desk" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "My Desk",
    description: "where your docs meet automation",
    images: ["/share-image.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
