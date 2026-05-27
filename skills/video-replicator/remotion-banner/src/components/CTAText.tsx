import React from "react";

interface CTATextProps {
  text: string;
  phoneNumber: string;
  textColor: string;
  accentColor: string;
  phoneColor: string;
  fontSize?: number;
  centered?: boolean;
}

export const CTAText: React.FC<CTATextProps> = ({
  text,
  phoneNumber,
  textColor,
  accentColor,
  phoneColor,
  fontSize = 36,
  centered = false,
}) => {
  // Split text to highlight the phone number
  const parts = text.split(phoneNumber);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: centered ? "center" : "flex-start",
        justifyContent: "center",
        textAlign: centered ? "center" : "left",
      }}
    >
      <div
        style={{
          fontFamily: "'Arial', sans-serif",
          fontSize: fontSize,
          fontWeight: 500,
          color: textColor,
          lineHeight: 1.3,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: centered ? "center" : "flex-start",
          gap: "8px",
        }}
      >
        {parts.map((part, index) => (
          <React.Fragment key={index}>
            <span>{part}</span>
            {index < parts.length - 1 && (
              <span
                style={{
                  fontWeight: 700,
                  fontSize: fontSize * 1.2,
                  color: phoneColor,
                }}
              >
                {phoneNumber}
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
