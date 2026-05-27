import { Composition } from "remotion";
import { CTABanner, CTABannerProps } from "./CTABanner";
import { CTABannerPortrait } from "./CTABannerPortrait";

// Default props for preview
const defaultProps: CTABannerProps = {
  logoUrl: "",
  companyName: "Your Company",
  phoneNumber: "555-123-4567",
  ctaText: "Scan or call {phone} to schedule an appointment",
  qrCodeUrl: "https://example.com",
  animation: "slide-fade",
  theme: "light",
  timing: {
    startFrame: 0,
    showDuration: 150, // 5 seconds at 30fps
  },
  customColors: {
    background: "#FFFFFF",
    text: "#1a1a2e",
    accent: "#4a00e0",
  },
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Landscape 16:9 */}
      <Composition
        id="CTABanner"
        component={CTABanner}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
      />

      {/* Portrait 9:16 */}
      <Composition
        id="CTABannerPortrait"
        component={CTABannerPortrait}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />

      {/* Banner only (for overlay - transparent background) */}
      <Composition
        id="CTABannerOverlay"
        component={CTABanner}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={200}
        defaultProps={{ ...defaultProps, overlayMode: true }}
      />

      <Composition
        id="CTABannerOverlayPortrait"
        component={CTABannerPortrait}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={350}
        defaultProps={{ ...defaultProps, overlayMode: true }}
      />
    </>
  );
};
