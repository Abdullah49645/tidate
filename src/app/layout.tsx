import type { Metadata, Viewport } from "next";
import "@fontsource-variable/public-sans";
import "@fontsource-variable/big-shoulders-display";
import "./globals.css";

export const metadata: Metadata = {
  title: "Undertow — concert date clash risk",
  description:
    "Rank the concert dates you can hold by how much nearby shows compete for an overlapping audience. Ticketmaster events weighted by Qloo affinity, with every number traceable.",
};

export const viewport: Viewport = { themeColor: "#E9EEEA" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
