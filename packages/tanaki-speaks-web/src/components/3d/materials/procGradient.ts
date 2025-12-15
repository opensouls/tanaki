import * as THREE from "three";
import type { IUniform } from "three";

export type GradientMaterialOptions = {
  axis?: "x" | "y" | "z" | "-x" | "-y" | "-z";
  axisSpace?: "geometry" | "world";
  colors?: THREE.ColorRepresentation[];
  stops?: number[];
  metalness?: number;
  roughness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  opacities?: number[];
};

export function createObjectSpaceGradientMaterial(
  geometry: THREE.BufferGeometry,
  opts: GradientMaterialOptions = {}
): THREE.MeshStandardMaterial {
  const axisOption = (opts.axis ?? "y") as NonNullable<GradientMaterialOptions["axis"]>;
  const axisBase = (axisOption.startsWith("-") ? axisOption.slice(1) : axisOption) as "x" | "y" | "z";
  const axisSign = axisOption.startsWith("-") ? -1 : 1;
  const axisSpace = opts.axisSpace ?? "geometry";
  const MAX_STOPS = 8;
  const userColors = (opts.colors ?? ["#ff1e7a", "#ff7a00", "#ffd400"]) as THREE.ColorRepresentation[];
  const baseCount = Math.max(2, Math.min(userColors.length, MAX_STOPS));
  const defaultStops = Array.from({ length: baseCount }, (_, i) => (baseCount === 1 ? 0 : i / (baseCount - 1)));
  const userStopsRaw = opts.stops && opts.stops.length > 0 ? opts.stops.slice(0, MAX_STOPS) : defaultStops;
  const userOpacitiesRaw = opts.opacities && opts.opacities.length > 0 ? opts.opacities.slice(0, MAX_STOPS) : undefined;

  // Pair colors and stops, clamp and sort by stop
  const paired = Array.from({ length: Math.min(userColors.length, userStopsRaw.length) }, (_, i) => ({
    color: new THREE.Color(userColors[i]),
    stop: Math.max(0, Math.min(1, userStopsRaw[i])),
    opacity: Math.max(0, Math.min(1, userOpacitiesRaw ? userOpacitiesRaw[i] ?? 1 : 1)),
  }))
    .filter((p, idx) => idx < MAX_STOPS)
    .sort((a, b) => a.stop - b.stop);

  // Ensure at least two points
  if (paired.length === 1) {
    const only = paired[0];
    paired.push({ color: only.color.clone(), stop: 1.0, opacity: only.opacity });
  }

  const stopCount = Math.min(paired.length, MAX_STOPS);
  const stops: number[] = [];
  const colors: THREE.Color[] = [];
  const opacities: number[] = [];
  for (let i = 0; i < MAX_STOPS; i++) {
    if (i < stopCount) {
      stops[i] = paired[i].stop;
      colors[i] = paired[i].color;
      opacities[i] = paired[i].opacity;
    } else {
      // pad with last
      stops[i] = paired[stopCount - 1].stop;
      colors[i] = paired[stopCount - 1].color.clone();
      opacities[i] = paired[stopCount - 1].opacity;
    }
  }

  const material = new THREE.MeshStandardMaterial({
    metalness: opts.metalness ?? 0.0,
    roughness: opts.roughness ?? 0.35,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1.0,
  });

  // Enable transparency when any opacity < 1
  if (opacities.some((o) => o < 0.999)) {
    material.transparent = true;
    material.depthWrite = false;
  }

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const minBase = axisBase === "x" ? bb.min.x : axisBase === "y" ? bb.min.y : bb.min.z;
  const maxBase = axisBase === "x" ? bb.max.x : axisBase === "y" ? bb.max.y : bb.max.z;
  const min = axisSign > 0 ? minBase : -maxBase;
  const max = axisSign > 0 ? maxBase : -minBase;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMin = { value: min };
    shader.uniforms.uMax = { value: max };
    shader.uniforms.uStopCount = { value: stopCount };
    shader.uniforms.uStops = { value: stops };
    shader.uniforms.uColors = { value: colors };
    shader.uniforms.uOpacities = { value: opacities };
    shader.uniforms.uEmissiveIntensity = { value: opts.emissiveIntensity ?? 1.0 };
    shader.uniforms.uAxisDir = { value: new THREE.Vector3(
      axisBase === "x" ? axisSign : 0,
      axisBase === "y" ? axisSign : 0,
      axisBase === "z" ? axisSign : 0
    ) };
    shader.uniforms.uUseWorld = { value: axisSpace === "world" };

    // expose uniforms for runtime updates via material.userData
    type GradientUniformsUserData = {
      uMin?: IUniform;
      uMax?: IUniform;
      uAxisDir?: IUniform;
      uUseWorld?: IUniform;
    };
    const ud = material.userData as GradientUniformsUserData;
    ud.uMin = shader.uniforms.uMin as IUniform;
    ud.uMax = shader.uniforms.uMax as IUniform;
    ud.uAxisDir = shader.uniforms.uAxisDir as IUniform;
    ud.uUseWorld = shader.uniforms.uUseWorld as IUniform;

    shader.vertexShader = `
varying vec3 vPosObject;
varying vec3 vPosWorld;
${shader.vertexShader.replace(
  "#include <begin_vertex>",
  `#include <begin_vertex>
  vPosObject = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosWorld = worldPos.xyz;`
)}
`;

    const injected = shader.fragmentShader
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  vec3 p = uUseWorld ? vPosWorld : vPosObject;
  float coord = dot(p, uAxisDir);
  float t = remap(coord, uMin, uMax);
  vec3 grad = ramp(t);
  diffuseColor.rgb = grad;
  diffuseColor.a = diffuseColor.a * rampOpacity(t);`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  totalEmissiveRadiance = grad * uEmissiveIntensity;`
      );

    shader.fragmentShader = `
#define MAX_STOPS ${MAX_STOPS}
uniform float uMin, uMax;
uniform int uStopCount;
uniform float uStops[MAX_STOPS];
uniform vec3 uColors[MAX_STOPS];
uniform float uOpacities[MAX_STOPS];
uniform float uEmissiveIntensity;
uniform vec3 uAxisDir;
uniform bool uUseWorld;
varying vec3 vPosObject;
varying vec3 vPosWorld;

float remap(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }
vec3 ramp(float t) {
  vec3 color = uColors[0];
  for (int i = 0; i < MAX_STOPS - 1; i++) {
    if (i >= uStopCount - 1) break;
    float a = uStops[i];
    float b = uStops[i + 1];
    float segT = clamp((t - a) / max(1e-5, (b - a)), 0.0, 1.0);
    vec3 segColor = mix(uColors[i], uColors[i + 1], smoothstep(0.0, 1.0, segT));
    if (t >= a) {
      color = segColor;
    }
  }
  return color;
}

float rampOpacity(float t) {
  float opacity = uOpacities[0];
  for (int i = 0; i < MAX_STOPS - 1; i++) {
    if (i >= uStopCount - 1) break;
    float a = uStops[i];
    float b = uStops[i + 1];
    float segT = clamp((t - a) / max(1e-5, (b - a)), 0.0, 1.0);
    float segOpacity = mix(uOpacities[i], uOpacities[i + 1], smoothstep(0.0, 1.0, segT));
    if (t >= a) {
      opacity = segOpacity;
    }
  }
  return opacity;
}
${injected}
`;
  };

  return material;
}
