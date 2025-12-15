"use client";

import { OrbitControls } from "@react-three/drei";

export type ControlsProps = {
  enablePan?: boolean;
  enableZoom?: boolean;
  enableRotate?: boolean;
};

export default function Controls({
  enablePan = true,
  enableZoom = true,
  enableRotate = true,
}: ControlsProps) {
  return (
    <OrbitControls
      makeDefault
      enablePan={enablePan}
      enableZoom={enableZoom}
      enableRotate={enableRotate}
      enableDamping
      dampingFactor={0.05}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      panSpeed={0.8}
    />
  );
}


