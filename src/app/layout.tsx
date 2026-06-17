import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spajz — home pantry",
  description: "Import your last Rohlik order into a home pantry.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
