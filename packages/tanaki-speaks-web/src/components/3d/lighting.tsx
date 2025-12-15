"use client";

export type LightingProps = {
  ambientIntensity?: number;
  directionalIntensity?: number;
  directionalPosition?: [number, number, number];
};

export default function Lighting({
  ambientIntensity = 0.5,
  directionalIntensity = 1.1,
  directionalPosition = [3, 5, 2],
}: LightingProps) {
  return (
    <>
      <ambientLight intensity={ambientIntensity} />
      <directionalLight
        position={directionalPosition}
        intensity={directionalIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
    </>
  );
}


