export interface ThemeConfig {
  name: string;
  background: string;
  text: string;
  accent: string;
  phoneColor: string;
  shadow: string;
  qrBackground: string;
  qrForeground: string;
}

export const lightTheme: ThemeConfig = {
  name: "light",
  background: "#FFFFFF",
  text: "#1a1a2e",
  accent: "#4a00e0",
  phoneColor: "#1a1a2e",
  shadow: "0 -4px 20px rgba(0, 0, 0, 0.1)",
  qrBackground: "#FFFFFF",
  qrForeground: "#000000",
};

export const darkTheme: ThemeConfig = {
  name: "dark",
  background: "#1a1a2e",
  text: "#FFFFFF",
  accent: "#8b5cf6",
  phoneColor: "#FFFFFF",
  shadow: "0 -4px 20px rgba(0, 0, 0, 0.3)",
  qrBackground: "#FFFFFF",
  qrForeground: "#1a1a2e",
};

export const transparentTheme: ThemeConfig = {
  name: "transparent",
  background: "rgba(0, 0, 0, 0.75)",
  text: "#FFFFFF",
  accent: "#60a5fa",
  phoneColor: "#FFFFFF",
  shadow: "none",
  qrBackground: "#FFFFFF",
  qrForeground: "#000000",
};

// For custom theme, these are defaults that get overridden
export const customTheme: ThemeConfig = {
  name: "custom",
  background: "#FFFFFF",
  text: "#1a1a2e",
  accent: "#4a00e0",
  phoneColor: "#1a1a2e",
  shadow: "0 -4px 20px rgba(0, 0, 0, 0.1)",
  qrBackground: "#FFFFFF",
  qrForeground: "#000000",
};

export const themes = {
  light: lightTheme,
  dark: darkTheme,
  transparent: transparentTheme,
  custom: customTheme,
};

export type ThemeType = keyof typeof themes;

export const getTheme = (
  themeName: ThemeType,
  customColors?: {
    background?: string;
    text?: string;
    accent?: string;
  }
): ThemeConfig => {
  const baseTheme = themes[themeName];

  if (themeName === "custom" && customColors) {
    return {
      ...baseTheme,
      background: customColors.background || baseTheme.background,
      text: customColors.text || baseTheme.text,
      accent: customColors.accent || baseTheme.accent,
      phoneColor: customColors.text || baseTheme.phoneColor,
    };
  }

  return baseTheme;
};
