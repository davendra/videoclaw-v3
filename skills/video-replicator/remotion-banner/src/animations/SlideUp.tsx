import { useCurrentFrame, interpolate, Easing } from "remotion";
import React from "react";

interface SlideUpProps {
  children: React.ReactNode;
  startFrame: number;
  duration: number; // in frames
  distance: number; // pixels to slide
}

export const SlideUp: React.FC<SlideUpProps> = ({
  children,
  startFrame,
  duration,
  distance,
}) => {
  const frame = useCurrentFrame();

  const translateY = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [distance, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );

  return (
    <div
      style={{
        transform: `translateY(${translateY}px)`,
        width: "100%",
        height: "100%",
      }}
    >
      {children}
    </div>
  );
};
