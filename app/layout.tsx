import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DBNet — Database workspace",
  description: "A focused workspace for PostgreSQL and MySQL.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
