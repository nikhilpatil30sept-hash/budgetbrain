import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Float } from "@react-three/drei";
import * as THREE from "three";

/**
 * The one real-3D element in the app: a glass savings jar that fills with
 * coins as overall goal progress grows. Idles with a slow bob + spin,
 * leans gently toward the cursor, and drops new coins in with a bounce
 * when progress increases. Geometry is deliberately primitive (cylinders,
 * a torus) and lighting is two lights — cheap enough for 60fps on
 * integrated GPUs. No external assets are loaded (no HDRIs, no fonts).
 */

const MAX_COINS = 36;
const JAR_HEIGHT = 2.2;
const COIN_H = 0.11;
const DROP_FROM = 3.4;
const DROP_SECONDS = 0.85;

const GOLD = new THREE.Color("#FFC800");
const GOLD_DARK = new THREE.Color("#E0A400");

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** Deterministic pseudo-random per coin index so layouts don't reshuffle. */
function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface CoinSpec {
  x: number;
  z: number;
  y: number;
  rotY: number;
  tilt: number;
}

function coinSpec(i: number): CoinSpec {
  const layer = Math.floor(i / 3);
  const slot = i % 3;
  const angle = slot * ((Math.PI * 2) / 3) + jitter(i, 1) * 1.6;
  const radius = 0.16 + jitter(i, 2) * 0.34;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    y: -JAR_HEIGHT / 2 + COIN_H / 2 + layer * (COIN_H + 0.015),
    rotY: jitter(i, 3) * Math.PI,
    tilt: (jitter(i, 4) - 0.5) * 0.35,
  };
}

function Coins({ count }: { count: number }) {
  const prevCount = useRef(0);
  // Queue of {index, startTime} for coins currently falling.
  const falling = useRef<Map<number, number>>(new Map());
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const specs = useMemo(() => Array.from({ length: MAX_COINS }, (_, i) => coinSpec(i)), []);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (count !== prevCount.current) {
      if (count > prevCount.current) {
        // New coins drop in one after another, 0.18s apart.
        let stagger = 0;
        for (let i = prevCount.current; i < count; i++) {
          falling.current.set(i, now + stagger);
          stagger += 0.18;
        }
      }
      prevCount.current = count;
    }
    for (let i = 0; i < MAX_COINS; i++) {
      const mesh = meshes.current[i];
      if (!mesh) continue;
      const visible = i < count;
      mesh.visible = visible;
      if (!visible) {
        falling.current.delete(i);
        continue;
      }
      const spec = specs[i];
      const start = falling.current.get(i);
      if (start !== undefined) {
        const t = (now - start) / DROP_SECONDS;
        if (t < 0) {
          mesh.visible = false; // waiting for its turn in the stagger
        } else if (t >= 1) {
          falling.current.delete(i);
          mesh.position.y = spec.y;
        } else {
          mesh.position.y = DROP_FROM - (DROP_FROM - spec.y) * easeOutBounce(t);
        }
      }
    }
  });

  return (
    <group>
      {specs.map((s, i) => (
        <mesh
          key={i}
          ref={(m: THREE.Mesh | null) => {
            meshes.current[i] = m;
          }}
          position={[s.x, s.y, s.z]}
          rotation={[s.tilt, s.rotY, 0]}
          visible={false}
        >
          <cylinderGeometry args={[0.3, 0.3, COIN_H, 20]} />
          <meshStandardMaterial color={i % 2 ? GOLD : GOLD_DARK} metalness={0.55} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Jar({ progress }: { progress: number }) {
  const group = useRef<THREE.Group>(null);
  const coins = Math.round(Math.min(1, Math.max(0, progress)) * MAX_COINS);

  useFrame((state, delta) => {
    if (!group.current) return;
    // Slow idle spin + a gentle lean toward the cursor, eased with lerp.
    const targetY = group.current.rotation.y + delta * 0.25;
    group.current.rotation.y = targetY + (state.pointer.x * 0.45 - 0) * delta * 2;
    group.current.rotation.x = THREE.MathUtils.lerp(
      group.current.rotation.x,
      -state.pointer.y * 0.18,
      delta * 3
    );
  });

  return (
    <Float speed={1.6} rotationIntensity={0} floatIntensity={0.35}>
      <group ref={group}>
        {/* glass wall */}
        <mesh>
          <cylinderGeometry args={[1.05, 0.92, JAR_HEIGHT, 40, 1, true]} />
          <meshPhysicalMaterial
            color="#ffffff"
            transparent
            opacity={0.16}
            roughness={0.08}
            metalness={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* base */}
        <mesh position={[0, -JAR_HEIGHT / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.92, 40]} />
          <meshStandardMaterial color="#F3E9D9" roughness={0.6} />
        </mesh>
        {/* rim */}
        <mesh position={[0, JAR_HEIGHT / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.05, 0.07, 12, 40]} />
          <meshStandardMaterial color="#FF6B35" roughness={0.4} metalness={0.15} />
        </mesh>
        <Coins count={coins} />
      </group>
    </Float>
  );
}

export default function CoinJarScene({ progress }: { progress: number }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.9, 5.4], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 6, 3]} intensity={1.1} />
      <pointLight position={[-4, 2, -3]} intensity={0.4} color="#FF8557" />
      <Jar progress={progress} />
      <ContactShadows position={[0, -1.45, 0]} opacity={0.3} scale={6} blur={2.6} far={2.2} />
    </Canvas>
  );
}
