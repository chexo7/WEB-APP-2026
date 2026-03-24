import { createTheme } from "@mantine/core";

export const mantineTheme = createTheme({
  primaryColor: "blue",
  defaultRadius: "lg",
  fontFamily: '"Aptos", "Trebuchet MS", "Segoe UI", sans-serif',
  headings: {
    fontFamily: '"Aptos", "Trebuchet MS", "Segoe UI", sans-serif',
    fontWeight: "700",
  },
  radius: {
    xs: "10px",
    sm: "12px",
    md: "16px",
    lg: "20px",
    xl: "24px",
  },
  spacing: {
    xs: "10px",
    sm: "14px",
    md: "18px",
    lg: "24px",
    xl: "32px",
  },
  shadows: {
    xs: "0 10px 22px rgba(24, 45, 71, 0.06)",
    sm: "0 14px 32px rgba(24, 45, 71, 0.08)",
    md: "0 18px 40px rgba(24, 45, 71, 0.12)",
    lg: "0 28px 52px rgba(16, 36, 58, 0.16)",
    xl: "0 34px 68px rgba(16, 36, 58, 0.2)",
  },
  colors: {
    blue: [
      "#edf4ff",
      "#d9e7fb",
      "#b4d0f4",
      "#8cb7ed",
      "#68a2e8",
      "#4d93e4",
      "#3d8ade",
      "#2c76c4",
      "#1c62a8",
      "#0f4f8a",
    ],
  },
  components: {
    Button: {
      defaultProps: {
        radius: "xl",
        size: "sm",
      },
      styles: {
        root: {
          fontWeight: 700,
          letterSpacing: "-0.01em",
          boxShadow: "0 10px 24px rgba(24, 45, 71, 0.08)",
        },
      },
    },
    Paper: {
      defaultProps: {
        radius: "xl",
        shadow: "sm",
      },
    },
    Badge: {
      defaultProps: {
        radius: "xl",
        size: "md",
        variant: "light",
      },
      styles: {
        root: {
          fontWeight: 700,
          letterSpacing: "0.02em",
        },
      },
    },
    Tabs: {
      styles: {
        tab: {
          fontWeight: 700,
        },
      },
    },
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
        withTableBorder: true,
        withColumnBorders: true,
      },
      styles: {
        th: {
          fontSize: "0.74rem",
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        },
        td: {
          fontSize: "0.82rem",
        },
      },
    },
  },
});
