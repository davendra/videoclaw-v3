import { useCurrentFrame, interpolate, Easing } from "remotion";
import React from "react";

interface SlideAndFadeProps {
  children: React.ReactNode;
  startFrame: number;
  duration: number; // in frames
  distance: number; // pixels to slide
}

export const SlideAndFade: React.FC<SlideAndFadeProps> = ({
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

  const opacity = interpolate(
    frame,
    [startFrame, startFrame + duration * 0.7],
    [0, 1],
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
        opacity,
        width: "100%",
        height: "100%",
      }}
    >
      {children}
    </div>
  );
};
