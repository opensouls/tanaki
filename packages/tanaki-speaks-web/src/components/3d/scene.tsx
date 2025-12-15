"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, type PropsWithChildren } from "react";
import Controls from "./controls";
import Lighting from "./lighting";

export type SceneProps = PropsWithChildren<{
  className?: string;
  camera?: {
    position?: [number, number, number];
    fov?: number;
    near?: number;
    far?: number;
  };
  showControls?: boolean;
  showLighting?: boolean;
}>;

export default function Scene({
  className,
  camera,
  showControls = true,
  showLighting = true,
  children,
}: SceneProps) {
  const defaultCamera = {
    position: (camera?.position ?? [0, 1.2, 2.5]) as [number, number, number],
    fov: camera?.fov ?? 45,
    near: camera?.near ?? 0.1,
    far: camera?.far ?? 100,
  };

  return (
    <Canvas className={className} camera={defaultCamera} shadows>
      <Suspense fallback={null}>
        {showLighting && <Lighting />}
        {children}
        {showControls && <Controls />}
      </Suspense>
    </Canvas>
  );
}


