import "@mantine/core/styles.css";
import "./globals.css";
import { MantineProvider } from "@mantine/core";
import { mantineTheme } from "@/lib/mantine-theme";

export const metadata = {
  title: "WEB-APP-2026",
  description: "Panel Next.js conectado a Firebase Realtime Database",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <MantineProvider theme={mantineTheme}>{children}</MantineProvider>
      </body>
    </html>
  );
}
