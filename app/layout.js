import "./globals.css";

export const metadata = {
  title: "WEB-APP-2026",
  description: "Panel Next.js conectado a Firebase Realtime Database",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
