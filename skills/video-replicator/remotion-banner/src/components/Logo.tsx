import { Img } from "remotion";

interface LogoProps {
  logoUrl: string;
  companyName: string;
  maxHeight: number;
  textColor: string;
}

export const Logo: React.FC<LogoProps> = ({
  logoUrl,
  companyName,
  maxHeight,
  textColor,
}) => {
  // If no logo URL provided, show text fallback
  if (!logoUrl) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, sans-serif",
          fontWeight: "bold",
          fontSize: Math.round(maxHeight * 0.4),
          color: textColor,
        }}
      >
        {companyName}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: maxHeight,
      }}
    >
      <Img
        src={logoUrl}
        style={{
          maxHeight: maxHeight,
          maxWidth: "100%",
          objectFit: "contain",
        }}
        alt={companyName}
      />
    </div>
  );
};
