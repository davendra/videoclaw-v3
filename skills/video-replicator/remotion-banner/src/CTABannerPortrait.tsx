import { AbsoluteFill, useVideoConfig } from "remotion";
import { BannerProps, themes, ThemeConfig } from "./types";
import { Logo } from "./components/Logo";
import { CTAText } from "./components/CTAText";
import { QRCode } from "./components/QRCode";
import { SlideUp } from "./animations/SlideUp";
import { FadeIn } from "./animations/FadeIn";
import { SlideAndFade } from "./animations/SlideAndFade";

export interface CTABannerPortraitProps extends BannerProps {}

export const CTABannerPortrait: React.FC<CTABannerPortraitProps> = (props) => {
  const {
    logoUrl,
    companyName,
    phoneNumber,
    ctaText,
    qrCodeUrl,
    qrCodeDataUrl,
    animation,
    theme,
    timing,
    customColors,
    overlayMode = false,
  } = props;

  const { height, width } = useVideoConfig();

  // Get theme config
  let themeConfig: ThemeConfig = themes[theme];
  if (theme === "custom" && customColors) {
    themeConfig = {
      ...themeConfig,
      background: customColors.background,
      text: customColors.text,
      accent: customColors.accent,
      phoneColor: customColors.text,
    };
  }

  // Banner dimensions for portrait (taller, stacked layout)
  const bannerHeight = overlayMode ? height : Math.round(height * 0.2);

  // Format CTA text with phone number
  const formattedCTA = ctaText.replace("{phone}", phoneNumber);

  // Animation wrapper based on type
  const AnimationWrapper =
    animation === "slide"
      ? SlideUp
      : animation === "fade"
        ? FadeIn
        : animation === "slide-fade"
          ? SlideAndFade
          : ({ children }: { children: React.ReactNode }) => <>{children}</>;

  const bannerContent = (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: bannerHeight,
        backgroundColor: themeConfig.background,
        boxShadow: themeConfig.shadow,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        gap: "15px",
      }}
    >
      {/* Logo Section - Top */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Logo
          logoUrl={logoUrl}
          companyName={companyName}
          maxHeight={bannerHeight * 0.2}
          textColor={themeConfig.text}
        />
      </div>

      {/* CTA Text Section - Middle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <CTAText
          text={formattedCTA}
          phoneNumber={phoneNumber}
          textColor={themeConfig.text}
          accentColor={themeConfig.accent}
          phoneColor={themeConfig.phoneColor}
          fontSize={32}
          centered
        />
      </div>

      {/* QR Code Section - Bottom */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <QRCode
          url={qrCodeUrl}
          dataUrl={qrCodeDataUrl}
          size={bannerHeight * 0.35}
          backgroundColor="#FFFFFF"
          foregroundColor={theme === "dark" ? "#1a1a2e" : "#000000"}
        />
      </div>
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: overlayMode ? "transparent" : "transparent",
      }}
    >
      <AnimationWrapper
        startFrame={timing.startFrame}
        duration={30}
        distance={bannerHeight}
      >
        {bannerContent}
      </AnimationWrapper>
    </AbsoluteFill>
  );
};
