import { Img } from "remotion";

interface QRCodeProps {
  url: string;
  dataUrl?: string; // Pre-generated QR code as data URL
  size: number;
  backgroundColor: string;
  foregroundColor: string;
}

export const QRCode: React.FC<QRCodeProps> = ({
  url,
  dataUrl,
  size,
  backgroundColor,
  foregroundColor,
}) => {
  // If we have a pre-generated QR code data URL, use it
  if (dataUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          backgroundColor: backgroundColor,
          borderRadius: 8,
          padding: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
      >
        <Img
          src={dataUrl}
          style={{
            width: size - 16,
            height: size - 16,
            objectFit: "contain",
          }}
          alt="QR Code"
        />
      </div>
    );
  }

  // Fallback: Use a QR code API service
  // Note: For production, generate QR codes ahead of time and pass as dataUrl
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${Math.round(size)}x${Math.round(size)}&data=${encodeURIComponent(url)}&bgcolor=${backgroundColor.replace("#", "")}&color=${foregroundColor.replace("#", "")}`;

  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: backgroundColor,
        borderRadius: 8,
        padding: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
    >
      <Img
        src={qrApiUrl}
        style={{
          width: size - 16,
          height: size - 16,
          objectFit: "contain",
        }}
        alt="QR Code"
      />
    </div>
  );
};
