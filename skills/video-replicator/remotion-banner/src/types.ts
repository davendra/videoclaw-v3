export type AnimationType = "slide" | "fade" | "slide-fade" | "static";

export type ThemeType = "light" | "dark" | "transparent" | "custom";

export interface CustomColors {
  background: string;
  text: string;
  accent: string;
}

export interface TimingConfig {
  startFrame: number;
  showDuration: number; // in frames
}

export interface BannerProps {
  logoUrl: string;
  companyName: string;
  phoneNumber: string;
  ctaText: string;
  qrCodeUrl: string;
  qrCodeDataUrl?: string; // Pre-generated QR code as data URL
  animation: AnimationType;
  theme: ThemeType;
  timing: TimingConfig;
  customColors?: CustomColors;
  overlayMode?: boolean;
}

// Theme configurations
export interface ThemeConfig {
  background: string;
  text: string;
  accent: string;
  phoneColor: string;
  shadow: string;
}

export const themes: Record<ThemeType, ThemeConfig> = {
  light: {
    background: "#FFFFFF",
    text: "#1a1a2e",
    accent: "#4a00e0",
    phoneColor: "#1a1a2e",
    shadow: "0 -4px 20px rgba(0, 0, 0, 0.1)",
  },
  dark: {
    background: "#1a1a2e",
    text: "#FFFFFF",
    accent: "#8b5cf6",
    phoneColor: "#FFFFFF",
    shadow: "0 -4px 20px rgba(0, 0, 0, 0.3)",
  },
  transparent: {
    background: "rgba(0, 0, 0, 0.7)",
    text: "#FFFFFF",
    accent: "#60a5fa",
    phoneColor: "#FFFFFF",
    shadow: "none",
  },
  custom: {
    background: "#FFFFFF",
    text: "#1a1a2e",
    accent: "#4a00e0",
    phoneColor: "#1a1a2e",
    shadow: "0 -4px 20px rgba(0, 0, 0, 0.1)",
  },
};
