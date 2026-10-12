/**
 * Three.js scenes, loaded lazily and only when the device can afford them.
 *
 * Two scenes exist:
 *   - `backgroundScene` — a slow wireframe lattice behind the whole site
 *   - `heroScene`       — an interactive core on the home page that follows the
 *                         pointer and reacts to a click
 *
 * Both are built from line segments and points only (no textures, no lights, no
 * post-processing), which keeps them cheap on the GPU and small in the bundle.
 * Everything degrades to the CSS fallback when WebGL is missing or the visitor
 * asked for reduced motion.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
  WireframeGeometry,
  type WebGLRendererParameters,
} from 'three';

const BRASS = new Color('#dfa74c');
const MINT = new Color('#43bf9c');
const DIM = new Color('#2c3a34');

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

/** True when the device and the visitor's preferences allow motion work. */
export function motionAllowed(): boolean {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  return !reduced && !coarse;
}

function rendererFor(canvas: HTMLCanvasElement, alpha = true): WebGLRenderer {
  const options: WebGLRendererParameters = {
    canvas,
    alpha,
    antialias: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
  };
  const renderer = new WebGLRenderer(options);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  return renderer;
}

interface SceneHandle {
  dispose: () => void;
}

/* ------------------------------------------------------------- background */

export function createBackgroundScene(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = rendererFor(canvas);
  const scene = new Scene();
  const camera = new PerspectiveCamera(52, 1, 0.1, 200);
  camera.position.set(0, 6, 26);
  camera.lookAt(0, 0, 0);

  const cols = 26;
  const rows = 18;
  const spacingX = 2.1;
  const spacingZ = 1.5;
  const positions: number[] = [];
  const lineIndices: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = (col - (cols - 1) / 2) * spacingX;
      const z = (row - (rows - 1) / 2) * spacingZ;
      positions.push(x, 0, z);
      const index = row * cols + col;
      if (col < cols - 1) lineIndices.push(index, index + 1);
      if (row < rows - 1) lineIndices.push(index, index + cols);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(lineIndices);

  const lines = new LineSegments(
    geometry,
    new LineBasicMaterial({ color: DIM, transparent: true, opacity: 0.85 }),
  );
  scene.add(lines);

  // A sparse point cloud above the lattice adds depth without cost.
  const cloudCount = 220;
  const cloudPositions = new Float32Array(cloudCount * 3);
  for (let i = 0; i < cloudCount; i += 1) {
    cloudPositions[i * 3] = (Math.random() - 0.5) * 60;
    cloudPositions[i * 3 + 1] = Math.random() * 22 - 2;
    cloudPositions[i * 3 + 2] = (Math.random() - 0.5) * 44;
  }
  const cloudGeometry = new BufferGeometry();
  cloudGeometry.setAttribute('position', new BufferAttribute(cloudPositions, 3));
  const cloud = new Points(
    cloudGeometry,
    new PointsMaterial({ color: MINT, size: 0.14, transparent: true, opacity: 0.5, sizeAttenuation: true }),
  );
  scene.add(cloud);

  const basePositions = new Float32Array(positions);
  const waveAmp = 1.15;

  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;
  let frame = 0;
  let running = true;
  let visible = true;

  const onPointer = (event: PointerEvent) => {
    targetX = (event.clientX / window.innerWidth - 0.5) * 2;
    targetY = (event.clientY / window.innerHeight - 0.5) * 2;
  };

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  const attribute = geometry.getAttribute('position') as BufferAttribute;
  const clockStart = performance.now();

  const render = () => {
    if (!running) return;
    frame = requestAnimationFrame(render);
    const time = (performance.now() - clockStart) / 1000;

    pointerX += (targetX - pointerX) * 0.045;
    pointerY += (targetY - pointerY) * 0.045;

    for (let i = 0; i < attribute.count; i += 1) {
      const x = basePositions[i * 3] ?? 0;
      const z = basePositions[i * 3 + 2] ?? 0;
      const wave =
        Math.sin((x + time * 1.6) * 0.24) * waveAmp +
        Math.cos((z - time * 1.1) * 0.3) * waveAmp * 0.55;
      attribute.setY(i, wave);
    }
    attribute.needsUpdate = true;

    camera.position.x = pointerX * 3.4;
    camera.position.y = 6 - pointerY * 2.2;
    camera.lookAt(pointerX * 0.6, 0, 0);
    cloud.rotation.y = time * 0.03;

    renderer.render(scene, camera);
  };

  const onVisibility = () => {
    const shouldRun = document.visibilityState === 'visible' && visible;
    if (shouldRun && !running) {
      running = true;
      render();
    } else if (!shouldRun) {
      running = false;
      cancelAnimationFrame(frame);
    }
  };

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.dataset.ready = 'true';
  resize();
  render();

  return {
    dispose() {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      geometry.dispose();
      cloudGeometry.dispose();
      (lines.material as LineBasicMaterial).dispose();
      (cloud.material as PointsMaterial).dispose();
      renderer.dispose();
    },
  };
}

/* ------------------------------------------------------------------- hero */

export interface HeroOptions {
  /** Label shown while hovering — passed to the custom pointer. */
  cursorLabel?: string;
}

export function createHeroScene(canvas: HTMLCanvasElement): SceneHandle & { setActive: (value: boolean) => void } {
  const renderer = rendererFor(canvas);
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0.4, 7.2);

  const group = new Group();
  scene.add(group);

  const coreGeometry = new IcosahedronGeometry(1.65, 1);
  const shellGeometry = new WireframeGeometry(coreGeometry);
  const shell = new LineSegments(
    shellGeometry,
    new LineBasicMaterial({ color: BRASS, transparent: true, opacity: 0.72 }),
  );
  group.add(shell);

  const inner = new Mesh(
    new IcosahedronGeometry(1.12, 0),
    new MeshBasicMaterial({ color: DIM, transparent: true, opacity: 0.5 }),
  );
  group.add(inner);

  const hitGeometry = new IcosahedronGeometry(2.05, 0);
  const hitMesh = new Mesh(
    hitGeometry,
    new MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.02 }),
  );
  group.add(hitMesh);

  // Orbiting satellites: small points on tilted rings.
  const orbitCount = 42;
  const orbitPositions = new Float32Array(orbitCount * 3);
  const orbitMeta: { radius: number; speed: number; phase: number; tilt: number }[] = [];
  for (let i = 0; i < orbitCount; i += 1) {
    orbitMeta.push({
      radius: 2.35 + (i % 3) * 0.42,
      speed: 0.16 + ((i % 5) + 1) * 0.035,
      phase: (i / orbitCount) * Math.PI * 2,
      tilt: ((i % 4) - 1.5) * 0.42,
    });
  }
  const orbitGeometry = new BufferGeometry();
  orbitGeometry.setAttribute('position', new BufferAttribute(orbitPositions, 3));
  const orbit = new Points(
    orbitGeometry,
    new PointsMaterial({
      color: MINT,
      size: 0.085,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      blending: AdditiveBlending,
    }),
  );
  group.add(orbit);

  const pointer = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  let pulse = 0;
  let frame = 0;
  let running = true;
  let active = true;
  const clockStart = performance.now();

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };

  const onPointerLeave = () => {
    pointer.x = 0;
    pointer.y = 0;
  };

  const onPointerDown = () => {
    pulse = 1;
  };

  const resize = () => {
    const width = canvas.clientWidth || 480;
    const height = canvas.clientHeight || 480;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  const attribute = orbitGeometry.getAttribute('position') as BufferAttribute;
  const coreGeometryCopy = coreGeometry;

  const render = () => {
    if (!running) return;
    frame = requestAnimationFrame(render);
    const time = (performance.now() - clockStart) / 1000;

    smooth.x += (pointer.x - smooth.x) * 0.06;
    smooth.y += (pointer.y - smooth.y) * 0.06;
    pulse *= 0.94;

    group.rotation.y = time * 0.14 + smooth.x * 0.85;
    group.rotation.x = smooth.y * 0.6 + Math.sin(time * 0.22) * 0.06;

    const scale = 1 + pulse * 0.12;
    group.scale.setScalar(scale);

    for (let i = 0; i < orbitCount; i += 1) {
      const meta = orbitMeta[i]!;
      const angle = meta.phase + time * meta.speed;
      const y = Math.sin(angle * 1.4 + meta.tilt) * meta.radius * 0.32;
      attribute.setXYZ(
        i,
        Math.cos(angle) * meta.radius,
        y,
        Math.sin(angle) * meta.radius * Math.cos(meta.tilt),
      );
    }
    attribute.needsUpdate = true;

    renderer.render(scene, camera);
  };

  const onVisibility = () => {
    const shouldRun = document.visibilityState === 'visible' && active;
    if (shouldRun && !running) {
      running = true;
      render();
    } else if (!shouldRun) {
      running = false;
      cancelAnimationFrame(frame);
    }
  };

  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);

  canvas.dataset.ready = 'true';
  resize();
  render();

  return {
    setActive(value: boolean) {
      active = value;
      onVisibility();
    },
    dispose() {
      running = false;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      coreGeometryCopy.dispose();
      shellGeometry.dispose();
      hitGeometry.dispose();
      orbitGeometry.dispose();
      (shell.material as LineBasicMaterial).dispose();
      (inner.material as MeshBasicMaterial).dispose();
      (hitMesh.material as MeshBasicMaterial).dispose();
      (orbit.material as PointsMaterial).dispose();
      renderer.dispose();
    },
  };
}
