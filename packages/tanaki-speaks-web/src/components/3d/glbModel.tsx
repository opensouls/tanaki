"use client";

import { useRef, useEffect, useMemo } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import type { Object3D } from "three";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { createObjectSpaceGradientMaterial } from "./materials/procGradient";

export type GLBModelProps = {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  autoPlayAnimation?: boolean;
  animationName?: string;
  onLoaded?: () => void;
  hideNodes?: Array<string | RegExp>;
  logHierarchy?: boolean;
  logAnimations?: boolean;
  /**
   * Expose a tiny console API for debugging animations.
   * - `true` => uses default key `__glbAnimations`
   * - `"someKey"` => uses `window[someKey]`
   */
  exposeAnimationsToWindow?: boolean | string;
  onNodeClick?: (info: { name: string; object: Object3D }) => void;
  logClicks?: boolean;
  materialOverride?: MaterialOverride[];
  poseBlend?: {
    clipName: string;
    fromIndex?: number; // default 0
    toIndex?: number;   // default 1
    blend: number;      // 0..1
  };
};

type MaterialOverride = {
  matcher:
    | string
    | RegExp
    | ((name: string) => boolean)
    | Array<string | RegExp | ((name: string) => boolean)>;
  options?: Parameters<typeof createObjectSpaceGradientMaterial>[1];
};

export default function GLBModel({
  url,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  autoPlayAnimation = true,
  animationName,
  hideNodes,
  logHierarchy = false,
  logAnimations = false,
  exposeAnimationsToWindow = false,
  onNodeClick,
  logClicks = false,
  materialOverride,
  poseBlend,
}: GLBModelProps) {
  const groupRef = useRef<Object3D>(null!);
  const gltf = useGLTF(url);

  // Helpful for debugging: list all animation clips embedded in the GLB.
  useEffect(() => {
    if (!logAnimations) return;
    const clips = gltf.animations ?? [];
    const names = clips.map((c) => c.name);
    console.log(`[GLBModel] animations for ${url}:`, names);
  }, [gltf.animations, logAnimations, url]);

  const { effectiveClips, effectiveAnimationName, effectiveOverlayClipName } =
    useMemo(() => {
      const originalClips = gltf.animations;

      if (!poseBlend?.clipName) {
        return {
          effectiveClips: originalClips,
          effectiveAnimationName: animationName,
          effectiveOverlayClipName: undefined,
        };
      }

      const targetLower = poseBlend.clipName.toLowerCase();
      const baseOverlayClip =
        originalClips.find((c) => c.name === poseBlend.clipName) ||
        originalClips.find((c) => c.name.toLowerCase() === targetLower) ||
        originalClips.find((c) =>
          c.name.toLowerCase().includes(targetLower)
        ) ||
        null;

      if (!baseOverlayClip) {
        console.error(
          "Base animation clip not found for poseBlend:",
          poseBlend.clipName
        );
        return {
          effectiveClips: originalClips,
          effectiveAnimationName: animationName,
          effectiveOverlayClipName: undefined,
        };
      }

      const mouthTracks = baseOverlayClip.tracks.filter((t) => {
        const n = t.name.toLowerCase();
        return n.includes("mouth") || n.includes("phoneme");
      });

      if (mouthTracks.length === 0) {
        console.warn("No mouth/phoneme tracks found in", baseOverlayClip.name);
      }
      const overlayClip = new THREE.AnimationClip(
        baseOverlayClip.name + "__mouthOnly",
        baseOverlayClip.duration,
        mouthTracks.length > 0 ? mouthTracks : baseOverlayClip.tracks
      );
      const mouthTrackNames = new Set(mouthTracks.map((t) => t.name));

      let finalAnimationName = animationName;
      let mainClipNoMouth: THREE.AnimationClip | null = null;

      if (animationName) {
        const lower = animationName.toLowerCase();
        const baseMainClip =
          originalClips.find((c) => c.name === animationName) ||
          originalClips.find((c) => c.name.toLowerCase() === lower) ||
          originalClips.find((c) => c.name.toLowerCase().includes(lower)) ||
          null;

        if (baseMainClip) {
          if (baseMainClip.name === baseOverlayClip.name) {
            finalAnimationName = undefined;
          } else {
            const mainTracksNoMouth = baseMainClip.tracks.filter(
              (t) => !mouthTrackNames.has(t.name)
            );
            mainClipNoMouth = new THREE.AnimationClip(
              baseMainClip.name + "__noMouth",
              baseMainClip.duration,
              mainTracksNoMouth
            );
            finalAnimationName = mainClipNoMouth.name;
          }
        }
      }

      const clipsToUse = [...originalClips];
      clipsToUse.push(overlayClip);
      if (mainClipNoMouth) {
        clipsToUse.push(mainClipNoMouth);
      }

      return {
        effectiveClips: clipsToUse,
        effectiveAnimationName: finalAnimationName,
        effectiveOverlayClipName: overlayClip.name,
      };
    }, [gltf.animations, animationName, poseBlend?.clipName]);

    // use , names here to log the actual animation names.
  const { actions } = useAnimations(effectiveClips, groupRef);

  // Optional debug console API for quickly trying clip names.
  useEffect(() => {
    if (!exposeAnimationsToWindow) return;
    if (typeof window === "undefined") return;

    const key =
      typeof exposeAnimationsToWindow === "string"
        ? exposeAnimationsToWindow
        : "__glbAnimations";

    const api = {
      url,
      list: () => Object.keys(actions).sort((a, b) => a.localeCompare(b)),
      stopAll: (fadeOutSec = 0.15) => {
        for (const a of Object.values(actions)) {
          if (!a) continue;
          try {
            a.fadeOut(fadeOutSec);
            a.stop();
          } catch {}
        }
      },
      stop: (name: string, fadeOutSec = 0.15) => {
        const a = actions[name];
        if (!a) return;
        try {
          a.fadeOut(fadeOutSec);
          a.stop();
        } catch {}
      },
      play: (
        name: string,
        opts?: {
          exclusive?: boolean;
          fadeInSec?: number;
          loop?: "once" | "repeat";
          repetitions?: number;
          timeScale?: number;
          clampWhenFinished?: boolean;
        }
      ) => {
        const a = actions[name];
        if (!a) {
          console.warn(`[GLBModel] unknown animation: ${name}`, {
            available: Object.keys(actions),
          });
          return;
        }

        const exclusive = opts?.exclusive ?? true;
        const fadeInSec = opts?.fadeInSec ?? 0.15;
        const loop = opts?.loop ?? "repeat";
        const repetitions = opts?.repetitions ?? Infinity;
        const timeScale = opts?.timeScale ?? 1;
        const clampWhenFinished = opts?.clampWhenFinished ?? loop === "once";

        if (exclusive) {
          for (const other of Object.values(actions)) {
            if (!other || other === a) continue;
            try {
              other.fadeOut(0.1);
              other.stop();
            } catch {}
          }
        }

        a.enabled = true;
        a.timeScale = timeScale;
        if (loop === "once") {
          a.setLoop(THREE.LoopOnce, 0);
        } else {
          a.setLoop(THREE.LoopRepeat, repetitions);
        }
        a.clampWhenFinished = clampWhenFinished;

        a.reset().fadeIn(fadeInSec).play();
      },
      // For deep inspection in devtools
      actions,
    } as const;

    (window as any)[key] = api;
    console.log(
      `[GLBModel] Exposed animation controls at window.${key} (try: window.${key}.list(), window.${key}.play("..."))`
    );

    return () => {
      try {
        if ((window as any)[key] === api) delete (window as any)[key];
      } catch {}
    };
  }, [actions, exposeAnimationsToWindow, url]);

  useEffect(() => {
    if (!autoPlayAnimation || !effectiveAnimationName) {
      return;
    }
    const action = actions[effectiveAnimationName];
    if (!action) {
      console.error("Main animation not found:", effectiveAnimationName);
      return;
    }
    action.reset().fadeIn(0.2).play();
    return () => {
      if (action) {
        action.fadeOut(0.2);
        action.stop();
      }
    };
  }, [actions, autoPlayAnimation, effectiveAnimationName]);

  const scene = gltf.scene;

  // Optionally log hierarchy and hide matching nodes by name
  useEffect(() => {
    if (!scene) return;
    if (logHierarchy) {
      const lines: string[] = [];
      scene.traverse((obj) => {
        lines.push(obj.name || "<unnamed>");
      });
      console.log("Scene nodes (depth-first):", lines);
      // const mouthRelated = lines.filter((n) => n.includes("mouth"));
      // console.log("Mouth related nodes:", mouthRelated);
    }
    if (hideNodes && hideNodes.length > 0) {
      const match = (name: string) =>
        hideNodes.some((p) =>
          typeof p === "string" ? name === p : p.test(name)
        );
      scene.traverse((obj) => {
        if (obj.name && match(obj.name)) {
          obj.visible = false;
        }
      });
    }

    if (materialOverride && materialOverride.length > 0) {
      const predicateFromMatcher = (
        matcher: string | RegExp | ((name: string) => boolean)
      ) => (name: string) =>
        typeof matcher === "string"
          ? name === matcher
          : matcher instanceof RegExp
          ? matcher.test(name)
          : matcher(name);

      const matches = (m: MaterialOverride) => (name: string) => {
        if (Array.isArray(m.matcher)) {
          return m.matcher.some((mm) => predicateFromMatcher(mm)(name));
        }
        return predicateFromMatcher(m.matcher)(name);
      };
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh) {
          const mesh = obj as THREE.Mesh | THREE.SkinnedMesh;
          const name = mesh.name as string;
          for (const m of materialOverride) {
            if (name && matches(m)(name)) {
              const geometry = mesh.geometry as THREE.BufferGeometry;
              const newMat = createObjectSpaceGradientMaterial(
                geometry,
                m.options
              );

              // Preserve deformation capabilities when overriding materials:
              // - SkinnedMesh needs `material.skinning = true`
              // - Morph targets require `material.morphTargets`/`material.morphNormals`
              if (mesh instanceof THREE.SkinnedMesh) {
                newMat.skinning = true;
              }
              const morphPos = geometry.morphAttributes?.position;
              const morphNorm = geometry.morphAttributes?.normal;
              if (morphPos && morphPos.length > 0) {
                newMat.morphTargets = true;
              }
              if (morphNorm && morphNorm.length > 0) {
                newMat.morphNormals = true;
              }

              const targetMesh = mesh as THREE.Mesh;
              targetMesh.material = newMat;
              newMat.needsUpdate = true;
            }
          }
        }
      });
    }
  }, [scene, hideNodes, logHierarchy, materialOverride]);

  // Overlay pose blending for a secondary clip (e.g., Tanaki_Phonemes)
  const overlayClip = useMemo(() => {
    if (!effectiveOverlayClipName) return null;
    return (
      effectiveClips.find((c) => c.name === effectiveOverlayClipName) || null
    );
  }, [effectiveClips, effectiveOverlayClipName]);

  const overlayTimes = useMemo(() => {
    if (!overlayClip) return [] as number[];
    const timeSet = new Set<number>();
    for (const track of overlayClip.tracks) {
      const keyTrack = track as THREE.KeyframeTrack;
      const times = keyTrack.times as Float32Array | number[] | undefined;
      if (!times) continue;
      const length = (times as Float32Array | number[]).length;
      for (let i = 0; i < length; i++) {
        const t = (times as Float32Array | number[])[i] as number;
        if (typeof t === "number") timeSet.add(t);
      }
    }
    return Array.from(timeSet).sort((a, b) => a - b);
  }, [overlayClip]);

  useEffect(() => {
    if (!poseBlend || !overlayClip) return;
    const action = actions[overlayClip.name];
    if (!action) return;
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
    action.weight = 1;
    action.timeScale = 0; // hold at a specific time
    action.play();
    return () => {
      try {
        action.stop();
      } catch {}
    };
  }, [actions, overlayClip, poseBlend]);

  useEffect(() => {
    if (!poseBlend || !overlayClip) return;
    const action = actions[overlayClip.name];
    if (!action) return;
    const fromIdx = poseBlend.fromIndex ?? 0;
    const toIdx = poseBlend.toIndex ?? 1;
    if (overlayTimes.length === 0) return;
    const safeFrom = Math.min(Math.max(0, fromIdx), overlayTimes.length - 1);
    const safeTo = Math.min(Math.max(0, toIdx), overlayTimes.length - 1);
    const t1 = overlayTimes[safeFrom];
    const t2 = overlayTimes[safeTo];
    const b = Math.min(Math.max(0, poseBlend.blend), 1);
    const t = t1 + (t2 - t1) * b;
    action.time = t;
  }, [actions, overlayClip, overlayTimes, poseBlend, poseBlend?.fromIndex, poseBlend?.toIndex, poseBlend?.blend]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const clicked = e.object as Object3D;
    const name = clicked.name || "<unnamed>";
    if (logClicks) {
      console.log("Clicked node:", name, clicked);
    }
    onNodeClick?.({ name, object: clicked });
  };

  return (
    <primitive
      ref={groupRef}
      object={scene}
      position={position}
      rotation={rotation}
      scale={scale}
      onClick={handleClick}
    />
  );
}

useGLTF.preload?.("/Tanaki-anim-web-v1.glb");


