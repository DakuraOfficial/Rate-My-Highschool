import type { Metadata } from "next";
import "./globals.css";
import {CompareProvider} from './components/CompareProvider';
import Header from './components/Header';

export const metadata: Metadata = {
  title: "Rate My Highschool | Find the right school for your family",
  description: "Search U.S. public high schools, compare community ratings, and share your school experience. Official NCES directory facts and transparent school reviews.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><CompareProvider><Header/><main>{children}</main><footer className="site-footer"><div className="container footer-inner"><a className="footer-brand" href="/">Rate My Highschool</a><p>School facts from NCES. Ratings from the community.</p><a href="/how-it-works">Sources & guidelines</a></div></footer></CompareProvider></body>
    </html>
  );
}
