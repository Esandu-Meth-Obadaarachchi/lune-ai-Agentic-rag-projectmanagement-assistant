import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { ThemeProvider } from "@/lib/theme/ThemeContext";

/* One superfamily rather than a pairing. Geist covers display through to dense
   UI text, and Geist Mono carries machine data (ids, counts, timestamps). The
   hierarchy comes from the optical tracking ramp in globals.css, which is the
   same move Apple makes with SF Display / SF Text. Self-hosted via the `geist`
   package, so there is no third-party font request at runtime. */

export const metadata: Metadata = {
  title: "Lune AI · Your Personal Workspace",
  description:
    "Lune AI is an AI-native project and knowledge workspace. Projects, tasks and a Claude agent that knows all your work.",
};

export const viewport: Viewport = {
  themeColor: "#08090d",
  width: "device-width",
  initialScale: 1,
  // Lets the app paint under the notch and home indicator, which is what makes
  // env(safe-area-inset-*) meaningful in the sheets and the toast stack.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the saved theme before paint to avoid a flash of the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('sb-theme')||'dark';var r=document.documentElement;r.classList.toggle('light',t==='light');r.classList.toggle('dark',t!=='light');}catch(e){}`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
