import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { BannerProps, themes, ThemeConfig } from "./types";
import { Logo } from "./components/Logo";
import { CTAText } from "./components/CTAText";
import { QRCode } from "./components/QRCode";
import { SlideUp } from "./animations/SlideUp";
import { FadeIn } from "./animations/FadeIn";
import { SlideAndFade } from "./animations/SlideAndFade";

export interface CTABannerProps extends BannerProps {}

export const CTABanner: React.FC<CTABannerProps> = (props) => {
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

  const frame = useCurrentFrame();
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

  // Banner dimensions
  const bannerHeight = overlayMode ? height : Math.round(height * 0.15);
  const bannerY = overlayMode ? 0 : height - bannerHeight;

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
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 40px",
      }}
    >
      {/* Logo Section - Left */}
      <div
        style={{
          flex: "0 0 15%",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
        }}
      >
        <Logo
          logoUrl={logoUrl}
          companyName={companyName}
          maxHeight={bannerHeight * 0.7}
          textColor={themeConfig.text}
        />
      </div>

      {/* CTA Text Section - Center */}
      <div
        style={{
          flex: "1 1 60%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 20px",
        }}
      >
        <CTAText
          text={formattedCTA}
          phoneNumber={phoneNumber}
          textColor={themeConfig.text}
          accentColor={themeConfig.accent}
          phoneColor={themeConfig.phoneColor}
        />
      </div>

      {/* QR Code Section - Right */}
      <div
        style={{
          flex: "0 0 15%",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <QRCode
          url={qrCodeUrl}
          dataUrl={qrCodeDataUrl}
          size={bannerHeight * 0.75}
          backgroundColor={theme === "dark" ? "#FFFFFF" : "#FFFFFF"}
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
        duration={30} // 1 second animation
        distance={bannerHeight}
      >
        {bannerContent}
      </AnimationWrapper>
    </AbsoluteFill>
  );
};
