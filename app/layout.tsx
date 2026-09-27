import type { Metadata } from "next";
import "./globals.css";
import "./animations.css";
import "./permit-standalone.css";

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
    images: [{ url: "/og.png", alt: "My Desk" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "My Desk",
    description: "where your docs meet automation",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning><div className="system-background" aria-hidden="true"><video className="system-background-video" autoPlay muted loop playsInline preload="auto" disablePictureInPicture draggable={false} tabIndex={-1} src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/bg.mp4`} /></div>{children}</body></html>;
}
