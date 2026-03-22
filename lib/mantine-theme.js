import { createTheme } from "@mantine/core";

export const mantineTheme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily: '"Aptos", "Trebuchet MS", "Segoe UI", sans-serif',
  headings: {
    fontFamily: '"Aptos", "Trebuchet MS", "Segoe UI", sans-serif',
    fontWeight: "700",
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
        radius: "md",
      },
    },
    Paper: {
      defaultProps: {
        radius: "lg",
        shadow: "sm",
      },
    },
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
        withTableBorder: true,
        withColumnBorders: true,
      },
    },
  },
});
