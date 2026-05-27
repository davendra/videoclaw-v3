import { useCurrentFrame, interpolate, Easing } from "remotion";
import React from "react";

interface FadeInProps {
  children: React.ReactNode;
  startFrame: number;
  duration: number; // in frames
  distance?: number; // unused, for interface compatibility
}

export const FadeIn: React.FC<FadeInProps> = ({
  children,
  startFrame,
  duration,
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [startFrame, startFrame + duration],
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
        opacity,
        width: "100%",
        height: "100%",
      }}
    >
      {children}
    </div>
  );
};
