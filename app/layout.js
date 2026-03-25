import "@mantine/core/styles.css";
import "./globals.css";
import { MantineProvider } from "@mantine/core";
import { mantineTheme } from "@/lib/mantine-theme";

export const metadata = {
  title: "Dinerito",
  description: "Dinerito, panel personal para seguir ingresos, gastos y flujo de caja.",
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
