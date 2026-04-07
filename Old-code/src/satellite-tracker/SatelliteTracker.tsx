import { useState, useEffect, useRef } from 'react';
// @ts-ignore
import * as THREE from 'three';// @ts-ignore
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as satellite from 'satellite.js';
import { Satellite, MapPin, Radio, Activity, Clock } from 'lucide-react';
import logoDark from '../../logo_dark.svg';
import satelliteModelUrl from '../../satellite.glb';

const EARTH_RADIUS_VISUAL = 5;
const SAT_SURFACE_MARGIN = 0.05;
const SAT_MODEL_EXTRA_YAW = Math.PI;
const DEFAULT_CAMERA_DISTANCE = 10.5;
const MIN_CAMERA_DISTANCE_FROM_CENTER = EARTH_RADIUS_VISUAL + 1.0;
const STARFIELD_OUTER_RADIUS = 420;
const SATELLITE_ANIMATION_MS_PER_MINUTE = 75;
const FAST_SATELLITE_ANIMATION_MS_PER_MINUTE = 0.01; // ultra-fast animation for user-triggered jumps
const SATELLITE_ANIMATION_MIN_MS = 1700;
const FAST_SATELLITE_ANIMATION_MIN_MS = 16; // lower bound during fast mode (~1 frame)
const SATELLITE_ANIMATION_MAX_MS = 2000;
const CAMERA_LERP_DURING_SATELLITE_ANIMATION = 0.06;

const getCameraDistanceSettings = () => {
  const isMobileViewport = window.innerWidth < 768;
  return {
    defaultDistance: isMobileViewport ? 14.5 : DEFAULT_CAMERA_DISTANCE,
    minDistance: isMobileViewport ? EARTH_RADIUS_VISUAL + 1.8 : MIN_CAMERA_DISTANCE_FROM_CENTER,
    orbitOffset: isMobileViewport ? 5.6 : 4.2,
  };
};

const blurActiveElement = () => {
  const active = document.activeElement as HTMLElement | null;
  active?.blur();
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const btnInlineStyles = {
  base: {
    padding: '10px 16px',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '600',
    transition: 'all 200ms',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    border: '2px solid',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    cursor: 'pointer',
  } as React.CSSProperties,
  primary: {
    backgroundColor: '#F27024',
    color: '#ffffff',
    borderColor: '#F27024',
  } as React.CSSProperties,
  secondary: {
    backgroundColor: '#ffffff',
    color: '#6b7280',
    borderColor: '#E5E7EB',
  } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SatelliteMetrics {
  gslantRange: number;
  ueslantRange: number;
  doppler: number;
  latency: number;
  satSpeed: number;
  taUE: number;
  taCommon: number;
  rtt: number;
}

interface InputState {
  gLat: string;
  gLon: string;
  ueLat: string;
  ueLon: string;
}

interface PassWindow {
  rise?: Date;
  peak: Date;
  set?: Date;
  peakElevation: number;
}

interface DistanceElevation {
  distanceKm: number;
  elevationDeg: number;
}

interface SuitablePassItem {
  pass: PassWindow;
  passNumber: number;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Client-side metrics computation
// Exact port of the Go backend logic in satellite.go
// ---------------------------------------------------------------------------
function computeMetrics(
  sLat: number,
  sLon: number,
  sAlt: number,
  sVel: number,
  gLat: number,
  gLon: number,
  ueLat?: number,
  ueLon?: number
): SatelliteMetrics {
  const earthRadius = 6371.0;
  const cSpeed = 299792.458;
  const fCenter = 2000.0;
  const rad = Math.PI / 180;

  const satR = earthRadius + sAlt;
  const sx = satR * Math.cos(sLat * rad) * Math.cos(sLon * rad);
  const sy = satR * Math.cos(sLat * rad) * Math.sin(sLon * rad);
  const sz = satR * Math.sin(sLat * rad);

  const gx = earthRadius * Math.cos(gLat * rad) * Math.cos(gLon * rad);
  const gy = earthRadius * Math.cos(gLat * rad) * Math.sin(gLon * rad);
  const gz = earthRadius * Math.sin(gLat * rad);

  const rvX = sx - gx;
  const rvY = sy - gy;
  const rvZ = sz - gz;
  const gsDist = Math.sqrt(rvX * rvX + rvY * rvY + rvZ * rvZ);

  let ueDist = 0;
  if (ueLat !== undefined && ueLon !== undefined && !isNaN(ueLat) && !isNaN(ueLon)) {
    const uex = earthRadius * Math.cos(ueLat * rad) * Math.cos(ueLon * rad);
    const uey = earthRadius * Math.cos(ueLat * rad) * Math.sin(ueLon * rad);
    const uez = earthRadius * Math.sin(ueLat * rad);
    const ueRX = sx - uex;
    const ueRY = sy - uey;
    const ueRZ = sz - uez;
    ueDist = Math.sqrt(ueRX * ueRX + ueRY * ueRY + ueRZ * ueRZ);
  }

  const angleEffect = Math.cos(sLat * rad);
  const dopplerShift = (sVel / cSpeed) * fCenter * angleEffect * 1000;

  const taUE =
    ueDist > 0
      ? Math.round((ueDist / cSpeed) * 1000000 * 1000) / 1000
      : 0;
  const taCommon = Math.round((gsDist / cSpeed) * 1000000 * 1000) / 1000;
  const rtt = Math.round((gsDist / cSpeed) * 2 * 1000 * 1000) / 1000;

  return {
    gslantRange: Math.round(gsDist * 100) / 100,
    ueslantRange: Math.round(ueDist * 100) / 100,
    doppler: Math.round(dopplerShift * 1000) / 1000,
    latency: Math.round((gsDist / cSpeed) * 1000 * 1000) / 1000,
    satSpeed: Math.round(sVel * 100) / 100,
    taUE,
    taCommon,
    rtt,
  };
}

function isVec3Like(value: unknown): value is Vec3Like {
  return !!value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SatelliteTracker() {
  const [animationMsPerMinute, setAnimationMsPerMinute] = useState<number>(SATELLITE_ANIMATION_MS_PER_MINUTE);
  const [metrics, setMetrics] = useState<SatelliteMetrics>({
    gslantRange: 0,
    ueslantRange: 0,
    doppler: 0,
    latency: 0,
    satSpeed: 0,
    taUE: 0,
    taCommon: 0,
    rtt: 0,
  });
  const [inputs, setInputs] = useState<InputState>({ gLat: '', gLon: '', ueLat: '', ueLon: '' });
  const [satInfo, setSatInfo] = useState({ name: '', norad: '' });
  const [manualTle, setManualTle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [gError, setGError] = useState<string | null>(null);
  const [ueError, setUeError] = useState<string | null>(null);
  const [simTime, setSimTime] = useState<string>('');
  const [passAnalysis, setPassAnalysis] = useState<string>('');
  const [suitablePassDetails, setSuitablePassDetails] = useState<string>('');
  const [suitablePassItems, setSuitablePassItems] = useState<SuitablePassItem[]>([]);
  const [selectedSuitablePassIndex, setSelectedSuitablePassIndex] = useState(0);
  const [uePassItems, setUePassItems] = useState<PassWindow[]>([]);
  const [gnbPassItems, setGnbPassItems] = useState<PassWindow[]>([]);
  const [selectedUeOtherPassIndex, setSelectedUeOtherPassIndex] = useState<number>(1);
  const [selectedGnbOtherPassIndex, setSelectedGnbOtherPassIndex] = useState<number>(1);
  const [centerPointDetails, setCenterPointDetails] = useState<string>('');
  const [isAnalyzingPasses, setIsAnalyzingPasses] = useState(false);
  const [isAnimatingToLock, setIsAnimatingToLock] = useState(false);
  const [lockedSatPosition, setLockedSatPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const [lockedMetricsTime, setLockedMetricsTime] = useState<Date | null>(null);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [isMobilePortrait, setIsMobilePortrait] = useState(false);
  const [activeMobilePanel, setActiveMobilePanel] = useState<'input' | 'metrics' | 'passes' | null>(null);
  const [showNoSuitablePassModal, setShowNoSuitablePassModal] = useState(false);
  const [noSuitablePassReason, setNoSuitablePassReason] = useState<string>('');

  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const satMeshRef = useRef<THREE.Object3D | null>(null);
  const wingMaterialRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const pinRef = useRef<THREE.Mesh | null>(null);
  const ueRef = useRef<THREE.Mesh | null>(null);
  const orbitRef = useRef<THREE.Line | null>(null);
  const satrecRef = useRef<any>(null);
  const cameraMoveRafRef = useRef<number | null>(null);
  const satModelRadiusRef = useRef<number>(0.43);

  // -------------------------------------------------------------------------
  // THREE.js scene setup
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleOrientationChange = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      setIsMobilePortrait(isPortrait);
      // Auto-hide right panel in portrait mobile
      if (isPortrait && window.innerWidth < 768) {
        setShowLeftPanel(true);
        setShowRightPanel(false);
        setActiveMobilePanel('input');
      }
    };

    handleOrientationChange();
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);

    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleOrientationChange);
    };
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const disposableGeometries: THREE.BufferGeometry[] = [];
    const disposableMaterials: THREE.Material[] = [];
    const disposableTextures: THREE.Texture[] = [];

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);

    // Background stars (layered + soft sprite for more realism)
    const createStarSprite = () => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const center = size / 2;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(255,255,255,1.0)');
      gradient.addColorStop(0.18, 'rgba(255,255,255,0.95)');
      gradient.addColorStop(0.5, 'rgba(220,235,255,0.55)');
      gradient.addColorStop(1, 'rgba(120,150,255,0.0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    };

    const starSprite = createStarSprite();
    if (starSprite) disposableTextures.push(starSprite);

    const createStarLayer = (
      count: number,
      radiusMin: number,
      radiusMax: number,
      size: number,
      opacity: number
    ) => {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = THREE.MathUtils.randFloat(radiusMin, radiusMax);

        const sinPhi = Math.sin(phi);
        const i3 = i * 3;
        positions[i3] = radius * sinPhi * Math.cos(theta);
        positions[i3 + 1] = radius * Math.cos(phi);
        positions[i3 + 2] = radius * sinPhi * Math.sin(theta);

        // Approximate stellar temperature distribution (mostly white, some warm/cool)
        const roll = Math.random();
        const intensity = THREE.MathUtils.randFloat(0.62, 1.18);
        let r = 0.95;
        let g = 0.96;
        let b = 1.0;
        if (roll < 0.12) { r = 1.0; g = 0.9; b = 0.78; }     // warm
        else if (roll > 0.88) { r = 0.76; g = 0.86; b = 1.0; } // cool blue

        colors[i3] = r * intensity;
        colors[i3 + 1] = g * intensity;
        colors[i3 + 2] = b * intensity;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
        size,
        sizeAttenuation: true,
        transparent: true,
        opacity,
        map: starSprite ?? undefined,
        alphaTest: 0.01,
        vertexColors: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      scene.add(points);

      disposableGeometries.push(geometry);
      disposableMaterials.push(material);
      return points;
    };

    const starsNear = createStarLayer(3000, 120, 220, 1.05, 0.92);
    const starsMid = createStarLayer(2800, 220, 320, 1.35, 0.96);
    const starsFar = createStarLayer(2400, 320, STARFIELD_OUTER_RADIUS, 1.65, 1.0);

    // Milky-way-like galactic band
    const bandGeometry = new THREE.BufferGeometry();
    const bandCount = 2000;
    const bandPositions = new Float32Array(bandCount * 3);
    const bandColors = new Float32Array(bandCount * 3);

    for (let i = 0; i < bandCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radial = THREE.MathUtils.randFloat(130, 310);
      const thickness = (Math.random() - 0.5) * 22;

      const i3 = i * 3;
      bandPositions[i3] = Math.cos(angle) * radial;
      bandPositions[i3 + 1] = thickness;
      bandPositions[i3 + 2] = Math.sin(angle) * radial;

      const core = 1 - Math.min(1, Math.abs(thickness) / 12);
      bandColors[i3] = 0.6 + core * 0.25;
      bandColors[i3 + 1] = 0.68 + core * 0.2;
      bandColors[i3 + 2] = 0.95 + core * 0.05;
    }

    bandGeometry.setAttribute('position', new THREE.BufferAttribute(bandPositions, 3));
    bandGeometry.setAttribute('color', new THREE.BufferAttribute(bandColors, 3));
    const bandMaterial = new THREE.PointsMaterial({
      size: 1.9,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      map: starSprite ?? undefined,
      alphaTest: 0.01,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const galacticBand = new THREE.Points(bandGeometry, bandMaterial);
    galacticBand.rotation.set(
      THREE.MathUtils.degToRad(25),
      THREE.MathUtils.degToRad(40),
      THREE.MathUtils.degToRad(8)
    );
    galacticBand.frustumCulled = false;
    scene.add(galacticBand);

    disposableGeometries.push(bandGeometry);
    disposableMaterials.push(bandMaterial);

    // Earth
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(
      'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
    );
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(5, 64, 64),
      new THREE.MeshPhongMaterial({ map: earthTexture })
    );
    scene.add(earth);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x222222, 0.25);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const fillLight = new THREE.PointLight(0xffffff, 0.12);
    fillLight.position.set(0, 4, 8);
    scene.add(fillLight);

    // Satellite model (body + solar panels)
    const satelliteGroup = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.06, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xffe36a,
        emissive: 0xffc400,
        emissiveIntensity: 0.65,
        metalness: 0.18,
        roughness: 0.14,
      })
    );
    satelliteGroup.add(body);

    const wingMaterial = new THREE.MeshStandardMaterial({ color: 0x39ff14, metalness: 0.15, roughness: 0.45 });
    wingMaterialRef.current = [wingMaterial];

    const leftPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.05, 0.01),
      wingMaterial
    );
    leftPanel.position.set(-0.27, 0, 0);
    satelliteGroup.add(leftPanel);

    const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.05, 0.01), wingMaterial);
    rightPanel.position.set(0.27, 0, 0);
    satelliteGroup.add(rightPanel);
    satModelRadiusRef.current = 0.43;

    // Try to load a realistic satellite model. If loading fails, fallback model remains.
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(
      satelliteModelUrl,
      (gltf: any) => {
        const model = gltf.scene;

        // Normalize size and center the model around local origin.
        const beforeBox = new THREE.Box3().setFromObject(model);
        const size = beforeBox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const targetSize = 0.72;
        const scale = targetSize / maxDim;
        model.scale.setScalar(scale);

        const afterBox = new THREE.Box3().setFromObject(model);
        const center = afterBox.getCenter(new THREE.Vector3());
        model.position.sub(center);
        const modelSphere = afterBox.getBoundingSphere(new THREE.Sphere());
        satModelRadiusRef.current = Math.max(0.2, modelSphere.radius);

        // Replace fallback geometry with loaded model.
        while (satelliteGroup.children.length > 0) {
          satelliteGroup.remove(satelliteGroup.children[0]);
        }
        satelliteGroup.add(model);

        // Detect likely panel/wing materials for dynamic orbit-class coloring.
        const panelMaterials = new Set<THREE.MeshStandardMaterial>();
        model.traverse((obj: THREE.Object3D) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh || !mesh.material) return;

          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const meshName = (mesh.name || '').toLowerCase();

          materials.forEach((mat) => {
            const m = mat as THREE.MeshStandardMaterial;
            if (!m || !('isMeshStandardMaterial' in m) || !m.isMeshStandardMaterial) return;
            const matName = (m.name || '').toLowerCase();
            const isPanelLike = /solar|panel|wing|array/.test(`${meshName} ${matName}`);
            if (isPanelLike) panelMaterials.add(m);
          });
        });

        if (panelMaterials.size > 0) {
          wingMaterialRef.current = Array.from(panelMaterials);
        }
      },
      undefined,
      (err: unknown) => {
        console.warn('satellite.glb load failed, using fallback model.', err);
      }
    );

    satMeshRef.current = satelliteGroup;
    scene.add(satelliteGroup);

    // Ground station dot (red)
    pinRef.current = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    scene.add(pinRef.current);

    // UE dot (yellow)
    ueRef.current = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xedc001 })
    );
    scene.add(ueRef.current);

    const cameraSettings = getCameraDistanceSettings();
    camera.position.z = cameraSettings.defaultDistance;
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = cameraSettings.minDistance;
    controls.target.set(0, 0, 0);
    controls.update();

    const animate = () => {
      requestAnimationFrame(animate);
      const t = performance.now() * 0.0001;
      starsNear.rotation.y = t * 0.08;
      starsMid.rotation.y = -t * 0.045;
      starsFar.rotation.y = t * 0.02;
      galacticBand.rotation.y = THREE.MathUtils.degToRad(40) + t * 0.018;

      // very subtle twinkle so scene feels alive without distraction
      const nearMat = starsNear.material as THREE.PointsMaterial;
      const midMat = starsMid.material as THREE.PointsMaterial;
      const farMat = starsFar.material as THREE.PointsMaterial;
      nearMat.opacity = 0.90 + 0.06 * Math.sin(t * 9.0);
      midMat.opacity = 0.94 + 0.06 * Math.sin(t * 7.1 + 1.2);
      farMat.opacity = 0.98 + 0.05 * Math.sin(t * 5.6 + 2.4);

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (cameraMoveRafRef.current !== null) {
        cancelAnimationFrame(cameraMoveRafRef.current);
        cameraMoveRafRef.current = null;
      }
      wingMaterialRef.current = [];
      controlsRef.current = null;
      cameraRef.current = null;
      disposableTextures.forEach((tex) => tex.dispose());
      disposableGeometries.forEach((geo) => geo.dispose());
      disposableMaterials.forEach((mat) => mat.dispose());
      renderer.dispose();
      if (mountRef.current?.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const getXYZ = (lat: number, lon: number, alt: number = 0): THREE.Vector3 => {
    const scaledAlt = Math.log(1 + alt / 1000) * 0.5;
    const r = 5 + scaledAlt;
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = ((lon + 180) * Math.PI) / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  };

  const applySatelliteClearance = (pos: THREE.Vector3): THREE.Vector3 => {
    const adjustedPos = pos.clone();
    const minRadiusFromCenter = EARTH_RADIUS_VISUAL + satModelRadiusRef.current + SAT_SURFACE_MARGIN;
    if (adjustedPos.length() < minRadiusFromCenter) {
      adjustedPos.setLength(minRadiusFromCenter);
    }
    return adjustedPos;
  };

  const setSatellitePose = (pos: THREE.Vector3) => {
    if (!satMeshRef.current) return;

    const adjustedPos = applySatelliteClearance(pos);

    satMeshRef.current.position.copy(adjustedPos);

    // Keep model aligned with local orbital frame so it stays horizontal-looking.
    const radial = adjustedPos.clone().normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const fallback = new THREE.Vector3(1, 0, 0);
    const reference = Math.abs(radial.dot(worldUp)) > 0.95 ? fallback : worldUp;

    const tangent = new THREE.Vector3().crossVectors(reference, radial).normalize();
    const normal = new THREE.Vector3().crossVectors(radial, tangent).normalize();

    const basis = new THREE.Matrix4().makeBasis(tangent, normal, radial);
    satMeshRef.current.quaternion.setFromRotationMatrix(basis);
    satMeshRef.current.rotateZ(Math.PI / 2);
    satMeshRef.current.rotateY(SAT_MODEL_EXTRA_YAW);
  };

  const centerViewOnSatellite = (pos: THREE.Vector3, lerp = 0.2) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const viewDir = pos.clone().normalize();
    const cameraSettings = getCameraDistanceSettings();
    const desiredDistance = Math.max(cameraSettings.defaultDistance, pos.length() + cameraSettings.orbitOffset);
    const desiredCameraPos = viewDir.multiplyScalar(desiredDistance).add(new THREE.Vector3(0, 0.8, 0));

    const amount = THREE.MathUtils.clamp(lerp, 0, 1);
    const startPos = camera.position.clone();
    const startLen = Math.max(startPos.length(), MIN_CAMERA_DISTANCE_FROM_CENTER);
    const targetLen = Math.max(desiredCameraPos.length(), MIN_CAMERA_DISTANCE_FROM_CENTER);

    const startDir = startPos.lengthSq() > 1e-9 ? startPos.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const targetDir = desiredCameraPos.lengthSq() > 1e-9 ? desiredCameraPos.clone().normalize() : new THREE.Vector3(0, 0, 1);

    const fullRot = new THREE.Quaternion().setFromUnitVectors(startDir, targetDir);
    const stepRot = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), fullRot, amount);
    const nextDir = startDir.clone().applyQuaternion(stepRot).normalize();
    const nextLen = THREE.MathUtils.lerp(startLen, targetLen, amount);

    camera.position.copy(nextDir.multiplyScalar(nextLen));

    // Keep orbit controls anchored to Earth center so gyro never pivots around satellite.
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    controls.update();
  };

  const animateViewToSatellite = (pos: THREE.Vector3, durationMs = 1200) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (cameraMoveRafRef.current !== null) {
      cancelAnimationFrame(cameraMoveRafRef.current);
      cameraMoveRafRef.current = null;
    }

    const viewDir = pos.clone().normalize();
    const cameraSettings = getCameraDistanceSettings();
    const desiredDistance = Math.max(cameraSettings.defaultDistance, pos.length() + cameraSettings.orbitOffset);
    const targetCameraPos = viewDir.multiplyScalar(desiredDistance).add(new THREE.Vector3(0, 0.8, 0));
    const startCameraPos = camera.position.clone();
    const startLen = Math.max(startCameraPos.length(), MIN_CAMERA_DISTANCE_FROM_CENTER);
    const targetLen = Math.max(targetCameraPos.length(), MIN_CAMERA_DISTANCE_FROM_CENTER);
    const startDir = startCameraPos.lengthSq() > 1e-9 ? startCameraPos.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const targetDir = targetCameraPos.lengthSq() > 1e-9 ? targetCameraPos.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const fullRot = new THREE.Quaternion().setFromUnitVectors(startDir, targetDir);
    const t0 = performance.now();

    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);

      const stepRot = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), fullRot, eased);
      const dirNow = startDir.clone().applyQuaternion(stepRot).normalize();
      const lenNow = THREE.MathUtils.lerp(startLen, targetLen, eased);
      camera.position.copy(dirNow.multiplyScalar(lenNow));

      controls.target.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
      controls.update();

      if (p < 1) {
        cameraMoveRafRef.current = requestAnimationFrame(step);
      } else {
        cameraMoveRafRef.current = null;
      }
    };

    cameraMoveRafRef.current = requestAnimationFrame(step);
  };

  const animateSatelliteToTime = (
    sr: any,
    fromTime: Date,
    toTime: Date,
    durationMs: number
  ): Promise<void> => {
    return new Promise((resolve) => {
      if (!satMeshRef.current) {
        resolve();
        return;
      }

      const startMs = fromTime.getTime();
      const endMs = toTime.getTime();

      if (startMs === endMs) {
        resolve();
        return;
      }

      const pvStart = satellite.propagate(sr, fromTime);
      const pvEnd = satellite.propagate(sr, toTime);
      if (!isVec3Like(pvStart?.position) || !isVec3Like(pvEnd?.position)) {
        resolve();
        return;
      }

      const pgStart = satellite.eciToGeodetic(pvStart.position, satellite.gstime(fromTime));
      const pgEnd = satellite.eciToGeodetic(pvEnd.position, satellite.gstime(toTime));
      if (!pgStart || !pgEnd) {
        resolve();
        return;
      }

      const startPos = applySatelliteClearance(
        getXYZ(satellite.degreesLat(pgStart.latitude), satellite.degreesLong(pgStart.longitude), pgStart.height)
      );
      const endPos = applySatelliteClearance(
        getXYZ(satellite.degreesLat(pgEnd.latitude), satellite.degreesLong(pgEnd.longitude), pgEnd.height)
      );

      const startDir = startPos.clone().normalize();
      const endDir = endPos.clone().normalize();
      const startLen = startPos.length();
      const endLen = endPos.length();
      const fullRot = new THREE.Quaternion().setFromUnitVectors(startDir, endDir);

      if (orbitRef.current && sceneRef.current) {
        sceneRef.current.remove(orbitRef.current);
        orbitRef.current = null;
      }

      setIsAnimatingToLock(true);
      const t0 = performance.now();

      const step = (now: number) => {
        const elapsed = now - t0;
        const p = Math.min(1, elapsed / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);

        const stepRot = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), fullRot, eased);
        const dirNow = startDir.clone().applyQuaternion(stepRot).normalize();
        const lenNow = THREE.MathUtils.lerp(startLen, endLen, eased);
        const posNow = dirNow.multiplyScalar(lenNow);

        setSatellitePose(posNow);
        centerViewOnSatellite(posNow, CAMERA_LERP_DURING_SATELLITE_ANIMATION);

        if (p < 1) {
          requestAnimationFrame(step);
        } else {
          setIsAnimatingToLock(false);
          resolve();
        }
      };

      requestAnimationFrame(step);
    });
  };

  const validateLatLonStr = (latStr: string, lonStr: string): string | null => {
    if (!latStr || !lonStr) return 'Latitude and longitude required';
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (isNaN(lat) || isNaN(lon)) return 'Latitude and longitude must be numbers';
    if (lat < -90 || lat > 90) return 'Latitude must be between -90 and 90';
    if (lon < -180 || lon > 180) return 'Longitude must be between -180 and 180';
    return null;
  };

  const validateOptionalLatLon = (latStr: string, lonStr: string): string | null => {
    if (!latStr && !lonStr) return null;
    return validateLatLonStr(latStr, lonStr);
  };

  const classifyOrbit = (altitudeKm: number): 'LEO' | 'MEO' | 'GEO' => {
    if (altitudeKm > 30000 && altitudeKm < 40000) return 'GEO';
    if (altitudeKm >= 2000) return 'MEO';
    return 'LEO';
  };

  const getOrbitColor = (type: 'LEO' | 'MEO' | 'GEO'): number => {
    switch (type) {
      case 'LEO': return 0x39ff14;
      case 'MEO': return 0xfff200;
      case 'GEO': return 0x2f6bff;
      default:    return 0xffaa00;
    }
  };

  const updateWingColorByAltitude = (altitudeKm: number) => {
    if (!wingMaterialRef.current.length) return;
    const orbitType = classifyOrbit(altitudeKm);
    const color = getOrbitColor(orbitType);
    wingMaterialRef.current.forEach((mat) => {
      mat.color.setHex(color);
      mat.emissive.setHex(color);
      mat.emissiveIntensity = 0.55;
      mat.toneMapped = false;
      mat.needsUpdate = true;
    });
  };

  const drawOrbit = (sr: any, referenceTime: Date = new Date(), centeredWindow = false) => {
    if (orbitRef.current && sceneRef.current) sceneRef.current.remove(orbitRef.current);

    const points = [];
    const testTime = new Date(referenceTime);
    const testPv = satellite.propagate(sr, testTime);
    let durationMinutes = 90;

    if (isVec3Like(testPv?.position)) {
      const testPg = satellite.eciToGeodetic(testPv.position, satellite.gstime(testTime));
      if (testPg?.height) {
        const orbitClass = classifyOrbit(testPg.height);
        if (orbitClass === 'MEO') durationMinutes = 360;
        else if (orbitClass === 'GEO') durationMinutes = 1440;
      }
    }

    const startOffsetMinutes = centeredWindow ? -Math.floor(durationMinutes / 2) : 0;
    const endOffsetMinutes = centeredWindow ? Math.floor(durationMinutes / 2) : durationMinutes;

    for (let i = startOffsetMinutes; i <= endOffsetMinutes; i += 2) {
      const time = new Date(referenceTime.getTime() + i * 60000);
      const pv = satellite.propagate(sr, time);
      if (!isVec3Like(pv?.position)) continue;
      const pg = satellite.eciToGeodetic(pv.position, satellite.gstime(time));
      if (!pg?.latitude || !pg?.longitude) continue;
      const rawPos = getXYZ(satellite.degreesLat(pg.latitude), satellite.degreesLong(pg.longitude), pg.height);
      points.push(applySatelliteClearance(rawPos));
    }

    if (sceneRef.current) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3, transparent: true, opacity: 0.9, fog: false })
      );
      sceneRef.current.add(line);
      orbitRef.current = line;
    }
  };

  const syncSatelliteToReferenceTime = (sr: any, referenceTime: Date, focusView = false) => {
    const pv = satellite.propagate(sr, referenceTime);
    if (!isVec3Like(pv?.position)) return;
    const pg = satellite.eciToGeodetic(pv.position, satellite.gstime(referenceTime));
    if (!pg) return;
    updateWingColorByAltitude(pg.height);
    const rawPos = getXYZ(satellite.degreesLat(pg.latitude), satellite.degreesLong(pg.longitude), pg.height);
    const adjustedPos = applySatelliteClearance(rawPos);
    setSatellitePose(adjustedPos);
    if (focusView) {
      animateViewToSatellite(adjustedPos, 1100);
    }
  };

  const parseTle = (tleData: string) => {
    blurActiveElement();
    setPassAnalysis('');
    setSuitablePassDetails('');
    setSuitablePassItems([]);
    setSelectedSuitablePassIndex(0);
    setUePassItems([]);
    setGnbPassItems([]);
    setSelectedUeOtherPassIndex(1);
    setSelectedGnbOtherPassIndex(1);
    setCenterPointDetails('');
    setLockedMetricsTime(null);
    const lines = tleData.trim().split('\n');
    if (lines.length < 2) { setError('Invalid TLE format'); return; }
    try {
      const l1 = lines[lines.length - 2];
      const l2 = lines[lines.length - 1];
      satrecRef.current = satellite.twoline2satrec(l1, l2);
      setSatInfo({ name: lines.length === 3 ? lines[0].trim() : 'MANUAL', norad: l1.substring(2, 7).trim() });
      const refTime = simTime ? new Date(simTime) : new Date();
      syncSatelliteToReferenceTime(satrecRef.current, refTime, true);
      drawOrbit(satrecRef.current, refTime);
      setError(null);
      setLockedSatPosition(null);
      if (isMobile) {
        setActiveMobilePanel(null);
      }
    } catch {
      setError('Failed to parse TLE');
    }
  };

  const getDistanceAndElevation = (sr: any, obsLatDeg: number, obsLonDeg: number, time: Date): DistanceElevation | null => {
    const pv = satellite.propagate(sr, time);
    if (!isVec3Like(pv?.position)) return null;
    const gmst = satellite.gstime(time);
    const satEcf = satellite.eciToEcf(pv.position, gmst);
    const observerGd = {
      latitude: satellite.degreesToRadians(obsLatDeg),
      longitude: satellite.degreesToRadians(obsLonDeg),
      height: 0,
    };
    const look = satellite.ecfToLookAngles(observerGd, satEcf);
    return { distanceKm: look.rangeSat, elevationDeg: radiansToDegrees(look.elevation) };
  };

  const refineThresholdCrossing = (sr: any, latDeg: number, lonDeg: number, tA: Date, tB: Date, thresholdDeg: number): Date => {
    let left = tA.getTime();
    let right = tB.getTime();
    let leftVal = (getDistanceAndElevation(sr, latDeg, lonDeg, new Date(left))?.elevationDeg ?? -90) - thresholdDeg;
    let rightVal = (getDistanceAndElevation(sr, latDeg, lonDeg, new Date(right))?.elevationDeg ?? -90) - thresholdDeg;
    for (let i = 0; i < 16; i++) {
      const mid = Math.floor((left + right) / 2);
      const midVal = (getDistanceAndElevation(sr, latDeg, lonDeg, new Date(mid))?.elevationDeg ?? -90) - thresholdDeg;
      if ((leftVal <= 0 && midVal <= 0) || (leftVal >= 0 && midVal >= 0)) { left = mid; leftVal = midVal; }
      else { right = mid; rightVal = midVal; }
      if (Math.abs(rightVal - leftVal) < 1e-6) break;
    }
    return new Date(Math.floor((left + right) / 2));
  };

  const findPasses = (sr: any, latDeg: number, lonDeg: number, start: Date, end: Date, minElevationDeg = 10): PassWindow[] => {
    const passes: PassWindow[] = [];
    const stepMs = 15000;
    let tPrev = new Date(start);
    let prevElev = getDistanceAndElevation(sr, latDeg, lonDeg, tPrev)?.elevationDeg ?? -90;
    let inside = prevElev >= minElevationDeg;
    let currentRise: Date | undefined = inside ? new Date(start) : undefined;
    let currentPeakTime = new Date(start);
    let currentPeakElev = prevElev;
    if (inside) { currentPeakTime = new Date(tPrev); currentPeakElev = prevElev; }

    for (let t = start.getTime() + stepMs; t <= end.getTime(); t += stepMs) {
      const tCurr = new Date(t);
      const currElev = getDistanceAndElevation(sr, latDeg, lonDeg, tCurr)?.elevationDeg ?? -90;

      if (!inside && prevElev < minElevationDeg && currElev >= minElevationDeg) {
        currentRise = refineThresholdCrossing(sr, latDeg, lonDeg, tPrev, tCurr, minElevationDeg);
        inside = true; currentPeakTime = tCurr; currentPeakElev = currElev;
      }
      if (inside && currElev > currentPeakElev) { currentPeakElev = currElev; currentPeakTime = tCurr; }
      if (inside && prevElev >= minElevationDeg && currElev < minElevationDeg) {
        const setTime = refineThresholdCrossing(sr, latDeg, lonDeg, tPrev, tCurr, minElevationDeg);
        passes.push({ rise: currentRise, peak: currentPeakTime, set: setTime, peakElevation: currentPeakElev });
        inside = false; currentRise = undefined;
      }
      tPrev = tCurr; prevElev = currElev;
    }
    if (inside) passes.push({ rise: currentRise, peak: currentPeakTime, peakElevation: currentPeakElev });
    return passes;
  };

  const formatUTC = (date: Date): string => date.toISOString().replace('T', ' ').slice(0, 19);

  const formatPassWindow = (pass: PassWindow): string => {
    const rise = pass.rise ? formatUTC(pass.rise).slice(11) : '--:--:--';
    const peak = formatUTC(pass.peak).slice(11);
    const set  = pass.set  ? formatUTC(pass.set).slice(11)  : '--:--:--';
    const date = formatUTC(pass.peak).slice(0, 10);
    return `${date}\n\t${rise} ➜ ${peak} ➜ ${set}`;
  };

  const formatPassOptionLabel = (pass: PassWindow): string => {
    const date = formatUTC(pass.peak).slice(0, 10);
    return date;
  };

  const formatPassTimesOnly = (pass: PassWindow): string => {
    const rise = pass.rise ? formatUTC(pass.rise).slice(11) : '--:--:--';
    const peak = formatUTC(pass.peak).slice(11);
    const set = pass.set ? formatUTC(pass.set).slice(11) : '--:--:--';
    return `${rise} ➜ ${peak} ➜ ${set}`;
  };

  const formatSuitablePassDetails = (
    item: SuitablePassItem,
    totalSuitable: number,
    displayIndex: number
  ): string => {
    return [
      `Showing suitable pass ${displayIndex} of ${totalSuitable}`,
      `Pass Number:    #${item.passNumber} out of all UE passes`,
      `Peak Time:      ${formatUTC(item.pass.peak)} UTC`,
      `Peak Elevation: ${item.pass.peakElevation.toFixed(2)}°`,
    ].join('\n');
  };

  // -------------------------------------------------------------------------
  // Pass analysis
  // -------------------------------------------------------------------------
  const analyzePassSuitability = async () => {
    setPassAnalysis('');
    setSuitablePassDetails('');
    setSuitablePassItems([]);
    setSelectedSuitablePassIndex(0);
    setUePassItems([]);
    setGnbPassItems([]);
    setSelectedUeOtherPassIndex(1);
    setSelectedGnbOtherPassIndex(1);
    setCenterPointDetails('');
    if (!satrecRef.current) { setPassAnalysis('❌ Load a TLE first.'); return; }
    const gsVal = validateLatLonStr(inputs.gLat, inputs.gLon);
    if (gsVal) { setPassAnalysis(`❌ Ground station coordinates invalid: ${gsVal}`); return; }
    const ueVal = validateLatLonStr(inputs.ueLat, inputs.ueLon);
    if (ueVal) { setPassAnalysis(`❌ UE coordinates required for pass suitability: ${ueVal}`); return; }

    setIsAnalyzingPasses(true);
    setAnimationMsPerMinute(FAST_SATELLITE_ANIMATION_MS_PER_MINUTE);
    try {
      const gLat = parseFloat(inputs.gLat);
      const gLon = parseFloat(inputs.gLon);
      const ueLat = parseFloat(inputs.ueLat);
      const ueLon = parseFloat(inputs.ueLon);
      const start = simTime ? new Date(simTime) : new Date();
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const uePasses = findPasses(satrecRef.current, ueLat, ueLon, start, end, 10);
      const gnbPasses = findPasses(satrecRef.current, gLat, gLon, start, end, 10);
      setUePassItems(uePasses);
      setGnbPassItems(gnbPasses);

      const out: string[] = [];
      if (uePasses.length === 0) out.push('No passes >=10° found for the UE.');
      else if (uePasses.length === 1) out.push(`   First/Only Pass: ${formatPassWindow(uePasses[0])}`);
      else {
        out.push(`UE First Pass: ${formatPassWindow(uePasses[0])}`);
      }

      out.push('');
      if (gnbPasses.length === 0) out.push('No passes >=10° found for the gNB.');
      else if (gnbPasses.length === 1) out.push(`   First/Only Pass: ${formatPassWindow(gnbPasses[0])}`);
      else {
        out.push(`gNB First Pass: ${formatPassWindow(gnbPasses[0])}`);
      }
      out.push('');

      if (uePasses.length === 0 && gnbPasses.length === 0) {
        out.push('');
        out.push('Reason: During the next 24 hours, the satellite never rises above 10° elevation');
        out.push('for the provided UE and gNB coordinates using the current TLE and start time.');
        setPassAnalysis(out.join('\n'));
        return;
      }

      const suitablePassCandidates: SuitablePassItem[] = uePasses
        .map((pass, index) => ({ pass, passNumber: index + 1 }))
        .filter((item) => item.pass.peakElevation >= 30);

      const suitablePass = suitablePassCandidates[0]?.pass;
      const suitablePassIndex = suitablePassCandidates[0]?.passNumber ?? 0;

      if (!suitablePass) {
        out.push('');
        out.push('Satellite passes are too low (<30°).');
        out.push('This satellite may not be suitable for your use case.');
        setPassAnalysis(out.join('\n'));
        setNoSuitablePassReason('Satellite passes are too low (<30°).\n\nNo suitable passes found during the next 24 hours for the provided coordinates.\n\nThis satellite may not be suitable for your use case.');
        setShowNoSuitablePassModal(true);
        return;
      }

      

      const suitableOut: string[] = [];
      suitableOut.push(`Pass Number:    #${suitablePassIndex} out of ${uePasses.length} UE passes`);
      suitableOut.push(`Peak Time:      ${formatUTC(suitablePass.peak)} UTC`);
      suitableOut.push(`Peak Elevation: ${suitablePass.peakElevation.toFixed(2)}°`);
      setSuitablePassDetails(suitableOut.join('\n'));
      setSuitablePassItems(suitablePassCandidates);

      const C_KM_PER_S = 299792.458;
      const searchStart = suitablePass.peak.getTime() - 10 * 60 * 1000;
      let bestTime = new Date(suitablePass.peak);
      let minDiff = Infinity;
      let bestUe: DistanceElevation | null = null;
      let bestGnb: DistanceElevation | null = null;

      for (let i = 0; i <= 1200; i++) {
        const evalTime = new Date(searchStart + i * 1000);
        const ueData = getDistanceAndElevation(satrecRef.current, ueLat, ueLon, evalTime);
        const gnbData = getDistanceAndElevation(satrecRef.current, gLat, gLon, evalTime);
        if (!ueData || !gnbData) continue;
        const diff = Math.abs(ueData.distanceKm - gnbData.distanceKm);
        if (diff < minDiff) { minDiff = diff; bestTime = evalTime; bestUe = ueData; bestGnb = gnbData; }
      }

      if (!bestUe || !bestGnb) { out.push('❌ Could not compute center point.'); setPassAnalysis(out.join('\n')); return; }

      const pvBest = satellite.propagate(satrecRef.current, bestTime);
      if (!isVec3Like(pvBest?.position)) { out.push('❌ Could not determine satellite position at center point.'); setPassAnalysis(out.join('\n')); return; }

      if (satMeshRef.current) {
        const pgBestMesh = satellite.eciToGeodetic(pvBest.position, satellite.gstime(bestTime));
        if (pgBestMesh) {
          const animFromTime = lockedMetricsTime ?? (simTime ? new Date(simTime) : new Date());
          const deltaMinutes = Math.abs(bestTime.getTime() - animFromTime.getTime()) / 60000;
          const minMs = animationMsPerMinute === FAST_SATELLITE_ANIMATION_MS_PER_MINUTE ? FAST_SATELLITE_ANIMATION_MIN_MS : SATELLITE_ANIMATION_MIN_MS;
          const animDurationMs = Math.max(
            minMs,
            Math.min(SATELLITE_ANIMATION_MAX_MS, deltaMinutes * animationMsPerMinute)
          );

          await animateSatelliteToTime(satrecRef.current, animFromTime, bestTime, animDurationMs);

          const rawPos = getXYZ(satellite.degreesLat(pgBestMesh.latitude), satellite.degreesLong(pgBestMesh.longitude), pgBestMesh.height);
          const adjustedPos = applySatelliteClearance(rawPos);
          setSatellitePose(adjustedPos);
          centerViewOnSatellite(adjustedPos, 0.2);
          drawOrbit(satrecRef.current, bestTime, true);
          setLockedSatPosition({ x: adjustedPos.x, y: adjustedPos.y, z: adjustedPos.z });
          setLockedMetricsTime(new Date(bestTime));
        }
      }

      const taUeMs     = ((bestUe.distanceKm  * 2) / C_KM_PER_S) * 1000;
      const taCommonMs = ((bestGnb.distanceKm * 2) / C_KM_PER_S) * 1000;
      const taDiffMs   = Math.abs(taUeMs - taCommonMs);

      const pgBest = satellite.eciToGeodetic(pvBest.position, satellite.gstime(bestTime));

      const centerOut: string[] = [];
      centerOut.push(`⏱  Time:    ${formatUTC(bestTime)} UTC`);
      centerOut.push('');
      centerOut.push('🛰️ SATELLITE POSITION:');
      centerOut.push(`   Latitude:  ${pgBest.latitude.toFixed(4)}°`);
      centerOut.push(`   Longitude: ${pgBest.longitude.toFixed(4)}°`);
      centerOut.push(`   Altitude:  ${pgBest.height.toFixed(2)} km`);
      centerOut.push('');
      centerOut.push('📱 UE LINK:');
      centerOut.push(`   Distance:  ${bestUe.distanceKm.toFixed(2).padStart(8)} km`);
      centerOut.push(`   Elevation: ${bestUe.elevationDeg.toFixed(2).padStart(8)}°`);
      centerOut.push(`   TA (RTT):  ${taUeMs.toFixed(3).padStart(8)} ms`);
      centerOut.push('');
      centerOut.push('📡 gNB LINK:');
      centerOut.push(`   Distance:  ${bestGnb.distanceKm.toFixed(2).padStart(8)} km`);
      centerOut.push(`   Elevation: ${bestGnb.elevationDeg.toFixed(2).padStart(8)}°`);
      centerOut.push(`   TA (RTT):  ${taCommonMs.toFixed(3).padStart(8)} ms`);
      centerOut.push('');
      centerOut.push('   COMPARISON:');
      centerOut.push(`   TA Difference: ${taDiffMs.toFixed(6)} ms`);
      centerOut.push(`   Distance Δ:   ${Math.abs(bestUe.distanceKm - bestGnb.distanceKm).toFixed(2)} km`);
      setCenterPointDetails(centerOut.join('\n'));

      setPassAnalysis(out.join('\n'));
    } catch (e) {
      setIsAnimatingToLock(false);
      setPassAnalysis('❌ Failed to run pass analysis.');
      console.error(e);
    } finally {
      setAnimationMsPerMinute(SATELLITE_ANIMATION_MS_PER_MINUTE);
      setIsAnalyzingPasses(false);
    }
  };

  // -------------------------------------------------------------------------
  // Ground station / UE position updates
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!pinRef.current) return;
    const gLat = parseFloat(inputs.gLat);
    const gLon = parseFloat(inputs.gLon);
    if (!isNaN(gLat) && !isNaN(gLon)) pinRef.current.position.copy(getXYZ(gLat, gLon, 0));
  }, [inputs.gLat, inputs.gLon]);

  useEffect(() => {
    if (!ueRef.current) return;
    const ueLat = parseFloat(inputs.ueLat);
    const ueLon = parseFloat(inputs.ueLon);
    if (!isNaN(ueLat) && !isNaN(ueLon)) ueRef.current.position.copy(getXYZ(ueLat, ueLon, 0));
  }, [inputs.ueLat, inputs.ueLon]);

  // -------------------------------------------------------------------------
  // Metrics update loop — 100% client-side, no backend
  // -------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (!satrecRef.current) return;
      try {
        const simDateTime = lockedMetricsTime ?? (simTime ? new Date(simTime) : new Date());
        const pv = satellite.propagate(satrecRef.current, simDateTime);
        if (!isVec3Like(pv?.position) || !isVec3Like(pv?.velocity)) return;

        const pg = satellite.eciToGeodetic(pv.position, satellite.gstime(simDateTime));
        if (!pg?.latitude || !pg?.longitude) return;

        const sLat = satellite.degreesLat(pg.latitude);
        const sLon = satellite.degreesLong(pg.longitude);
        const sVel = Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2);
        updateWingColorByAltitude(pg.height);

        if (satMeshRef.current && !lockedSatPosition && !isAnimatingToLock) {
          setSatellitePose(getXYZ(sLat, sLon, pg.height));
        }

        const gLat = parseFloat(inputs.gLat);
        const gLon = parseFloat(inputs.gLon);
        const gsVal = validateLatLonStr(inputs.gLat, inputs.gLon);
        if (gsVal) { setGError(gsVal); return; }

        if (!isNaN(gLat) && !isNaN(gLon)) {
          const metricsData = computeMetrics(
            sLat, sLon, pg.height, sVel,
            gLat, gLon,
            inputs.ueLat ? parseFloat(inputs.ueLat) : undefined,
            inputs.ueLon ? parseFloat(inputs.ueLon) : undefined
          );
          setMetrics(metricsData);
        }
      } catch (err) {
        console.error('Error updating metrics:', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [inputs, simTime, lockedSatPosition, lockedMetricsTime, isAnimatingToLock]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const isMobile = window.innerWidth < 768;
  const isTablet = window.innerWidth < 1024;

  return (
    <>
      <style>{`
        .sat-sidebar::-webkit-scrollbar { width: 4px; }
        .sat-sidebar::-webkit-scrollbar-track { background: transparent; }
        .sat-sidebar::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.5); border-radius: 9999px; }
        .sat-sidebar::-webkit-scrollbar-thumb:hover { background: rgba(156,163,175,0.8); }
        .sat-sidebar { scrollbar-width: thin; scrollbar-color: rgba(156,163,175,0.5) transparent; color: #374151; }
        .sat-sidebar [class*="border-cyan"] { border-color: #E5E7EB !important; }
        .sat-sidebar input, .sat-sidebar textarea { background-color: #fff !important; border-color: #E5E7EB !important; color: #374151 !important; }
        .sat-sidebar input::placeholder, .sat-sidebar textarea::placeholder { color: #9CA3AF !important; }
        .sat-sidebar .text-green-400 { color: #F27024 !important; }
        .sat-sidebar .text-yellow-400 { color: #B45309 !important; }
        .sat-sidebar .text-red-400 { color: #DC2626 !important; }
        .sat-sidebar .text-cyan-400 { color: #374151 !important; }
        .datetime-picker::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.6; }
        
        @media (max-width: 767px) {
          .mobile-panel {
            position: fixed;
            top: 48px;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 50;
            background: white;
            overflow-y: auto;
            width: 100% !important;
          }
          .mobile-panel.hidden {
            display: none !important;
          }
          .mobile-globe-container {
            position: fixed;
            top: 48px;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: calc(100vh - 48px);
            z-index: 10;
          }
        }
      `}</style>

      <div className="w-full h-screen bg-black text-cyan-400 font-mono overflow-hidden flex flex-col md:flex-row min-w-0">

        {/* ── Mobile Menu Toggle ── */}
        {isMobile && (
          <div className="fixed top-0 left-0 right-0 h-12 bg-black border-b border-gray-700 flex gap-2 items-center px-3 z-40">
            <button
              onClick={() => setActiveMobilePanel(activeMobilePanel === 'input' ? null : 'input')}
              className="px-3 py-2 bg-[#F27024] text-white text-xs font-bold rounded hover:bg-orange-600"
            >
              {activeMobilePanel === 'input' ? '✕ INPUT' : '☰ INPUT'}
            </button>
            <button
              onClick={() => setActiveMobilePanel(activeMobilePanel === 'metrics' ? null : 'metrics')}
              className="px-3 py-2 bg-[#F27024] text-white text-xs font-bold rounded hover:bg-orange-600"
            >
              {activeMobilePanel === 'metrics' ? '✕ METRICS' : '☰ METRICS'}
            </button>
            <button
              onClick={async () => {
                if (lockedSatPosition) {
                  // GO LIVE function
                  const liveTime = simTime ? new Date(simTime) : new Date();
                  const fromTime = lockedMetricsTime ?? liveTime;

                  setPassAnalysis('');
                  setSuitablePassDetails('');
                  setSuitablePassItems([]);
                  setSelectedSuitablePassIndex(0);
                  setUePassItems([]);
                  setGnbPassItems([]);
                  setSelectedUeOtherPassIndex(1);
                  setSelectedGnbOtherPassIndex(1);
                  setCenterPointDetails('');

                  if (satrecRef.current) {
                        const deltaMinutes = Math.abs(liveTime.getTime() - fromTime.getTime()) / 60000;
                        const minMs = animationMsPerMinute === FAST_SATELLITE_ANIMATION_MS_PER_MINUTE ? FAST_SATELLITE_ANIMATION_MIN_MS : SATELLITE_ANIMATION_MIN_MS;
                        const animDurationMs = Math.max(
                          minMs,
                          Math.min(SATELLITE_ANIMATION_MAX_MS, deltaMinutes * animationMsPerMinute)
                        );
                        // speed up for user-initiated GO LIVE
                        setAnimationMsPerMinute(FAST_SATELLITE_ANIMATION_MS_PER_MINUTE);
                        try {
                          await animateSatelliteToTime(satrecRef.current, fromTime, liveTime, animDurationMs);
                        } finally {
                          setAnimationMsPerMinute(SATELLITE_ANIMATION_MS_PER_MINUTE);
                        }
                    syncSatelliteToReferenceTime(satrecRef.current, liveTime, true);
                    drawOrbit(satrecRef.current, liveTime);
                  }

                  setLockedSatPosition(null);
                  setLockedMetricsTime(null);
                  setActiveMobilePanel(null);
                } else {
                  // ANALYZE PASSES function
                  setActiveMobilePanel(activeMobilePanel === 'passes' ? null : 'passes');
                  if (activeMobilePanel !== 'passes') {
                    analyzePassSuitability();
                  }
                }
              }}
              disabled={isAnalyzingPasses || isAnimatingToLock}
              className="px-3 py-2 bg-[#F27024] text-white text-xs font-bold rounded hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {lockedSatPosition ? 'GO LIVE' : activeMobilePanel === 'passes' ? '✕ PASSES' : isAnalyzingPasses ? 'ANALYZING...' : 'ANALYZE PASSES'}
            </button>
          </div>
        )}

        {/* ── 3D Globe (Mobile) ── */}
        {isMobile && <div ref={mountRef} className="mobile-globe-container" />}

        {/* ── Left Panel ── */}
        <div
          className={`sat-sidebar shrink-0 bg-white border-r border-gray-200 p-4 md:p-6 overflow-y-auto flex flex-col gap-4 md:gap-6 ${
            isMobile
              ? `mobile-panel ${activeMobilePanel === 'input' ? '' : 'hidden'} pt-16`
              : isTablet
              ? 'w-64'
              : 'w-96'
          }`}
          style={!isMobile ? { width: 'clamp(16rem, 22vw, 21rem)' } : undefined}
        >

          <div className="flex justify-center">
            <img src={logoDark} alt="Simnovus" className="h-6 md:h-8 w-auto object-contain" />
          </div>
          <div className="text-center text-base md:text-lg font-semibold text-gray-700 -mt-2 md:-mt-3">Satellite Tracker</div>

          {/* Ground Station */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold border-b border-cyan-500/50 pb-2">
              <MapPin className="w-4 h-4" />
              Ground Station
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ff0000' }} />
            </div>
            <div className="space-y-2">
              <input type="number" step="0.01" placeholder="Latitude (e.g., 37.7749)"
                value={inputs.gLat}
                onChange={(e) => setInputs({ ...inputs, gLat: e.target.value })}
                onBlur={() => setGError(validateLatLonStr(inputs.gLat, inputs.gLon))}
                className="w-full bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-base md:text-sm" />
              <input type="number" step="0.01" placeholder="Longitude (e.g., -122.4194)"
                value={inputs.gLon}
                onChange={(e) => setInputs({ ...inputs, gLon: e.target.value })}
                onBlur={() => setGError(validateLatLonStr(inputs.gLat, inputs.gLon))}
                className="w-full bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-base md:text-sm" />
              {(!inputs.gLat || !inputs.gLon) && <p className="text-yellow-400 text-xs italic">⚠ Required for metrics calculation</p>}
              {gError && <p className="text-red-400 text-xs italic">⚠ {gError}</p>}
            </div>
          </div>

          {/* UE Location */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold border-b border-cyan-500/50 pb-2">
              <span className="text-lg">📱</span>
              UE Location
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#edc001' }} />
            </div>
            <div className="space-y-2">
              <input type="number" step="0.01" placeholder="Latitude"
                value={inputs.ueLat}
                onChange={(e) => setInputs({ ...inputs, ueLat: e.target.value })}
                onBlur={() => setUeError(validateOptionalLatLon(inputs.ueLat, inputs.ueLon))}
                className="w-full bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-base md:text-sm" />
              <input type="number" step="0.01" placeholder="Longitude"
                value={inputs.ueLon}
                onChange={(e) => setInputs({ ...inputs, ueLon: e.target.value })}
                onBlur={() => setUeError(validateOptionalLatLon(inputs.ueLat, inputs.ueLon))}
                className="w-full bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-base md:text-sm" />
              {(!inputs.ueLat || !inputs.ueLon) && <p className="text-gray-500 text-xs italic">Optional - for UE slant range</p>}
              {ueError && <p className="text-red-400 text-xs italic">⚠ {ueError}</p>}
            </div>
          </div>

          {/* TLE Input */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold border-b border-cyan-500/50 pb-2">
              <Activity className="w-4 h-4" />
              Manual TLE Input
            </div>
            <textarea placeholder="Paste TLE here (2 or 3 lines)..."
              value={manualTle}
              onChange={(e) => setManualTle(e.target.value)}
              className="w-full bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-base h-20 resize-none" />
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button onClick={() => parseTle(manualTle)}
                style={{ ...btnInlineStyles.base, ...btnInlineStyles.primary, minWidth: isMobile ? '100%' : '200px', fontSize: isMobile ? '13px' : '15px', padding: isMobile ? '8px 12px' : '10px 16px' }}>
                APPLY TLE
              </button>
            </div>
            {error && <div className="bg-red-50 border border-red-300 rounded p-2 text-xs md:text-sm text-red-600">{error}</div>}
          </div>

          {/* Pass Suitability */}
          {!isMobile && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold border-b border-cyan-500/50 pb-2">
              <Satellite className="w-4 h-4" />
              Pass Suitability
            </div>
            <button onClick={analyzePassSuitability} disabled={isAnalyzingPasses || isAnimatingToLock}
              style={{ ...btnInlineStyles.base, ...(isAnalyzingPasses ? btnInlineStyles.secondary : btnInlineStyles.primary), width: '100%', fontSize: isMobile ? '13px' : '15px', padding: isMobile ? '8px 12px' : '10px 16px' }}>
              {isAnimatingToLock ? 'FAST-FORWARDING...' : isAnalyzingPasses ? 'ANALYZING...' : 'ANALYZE PASSES'}
            </button>
            {lockedSatPosition && (
              <button onClick={async () => {
                const liveTime = simTime ? new Date(simTime) : new Date();
                const fromTime = lockedMetricsTime ?? liveTime;

                setPassAnalysis('');
                setSuitablePassDetails('');
                setSuitablePassItems([]);
                setSelectedSuitablePassIndex(0);
                setUePassItems([]);
                setGnbPassItems([]);
                setSelectedUeOtherPassIndex(1);
                setSelectedGnbOtherPassIndex(1);
                setCenterPointDetails('');

                if (satrecRef.current) {
                  const deltaMinutes = Math.abs(liveTime.getTime() - fromTime.getTime()) / 60000;
                  const minMs = animationMsPerMinute === FAST_SATELLITE_ANIMATION_MS_PER_MINUTE ? FAST_SATELLITE_ANIMATION_MIN_MS : SATELLITE_ANIMATION_MIN_MS;
                  const animDurationMs = Math.max(
                    minMs,
                    Math.min(SATELLITE_ANIMATION_MAX_MS, deltaMinutes * animationMsPerMinute)
                  );
                  await animateSatelliteToTime(satrecRef.current, fromTime, liveTime, animDurationMs);
                  syncSatelliteToReferenceTime(satrecRef.current, liveTime, true);
                  drawOrbit(satrecRef.current, liveTime);
                }

                setLockedSatPosition(null);
                setLockedMetricsTime(null);
              }}
                style={{ ...btnInlineStyles.base, ...btnInlineStyles.secondary, width: '100%', fontSize: isMobile ? '13px' : '15px', padding: isMobile ? '8px 12px' : '10px 16px' }}>
                GO LIVE
              </button>
            )}
            <p className="text-xs text-gray-500">
              Uses current TLE + UE/ground station coordinates for 24h pass suitability and equidistant TA point.
            </p>
          </div>
          )}
        </div>

        {/* ── 3D Globe (Desktop) ── */}
        {!isMobile && <div ref={mountRef} className="flex-1 min-w-0 bg-black" />}

        {/* ── Right Panel (Metrics) ── */}
        <div
          className={`sat-sidebar shrink-0 bg-white border-l border-gray-200 p-4 md:p-6 overflow-y-auto flex flex-col gap-4 md:gap-6 ${
            isMobile
              ? `mobile-panel ${activeMobilePanel === 'metrics' ? '' : 'hidden'}`
              : isTablet
              ? 'w-80'
              : 'w-96'
          }`}
          style={!isMobile ? { width: 'clamp(22rem, 30vw, 30rem)' } : undefined}
        >

          {/* Link Metrics */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold border-b border-cyan-500/50 pb-2">
              <Radio className="w-4 h-4" />
              Link Metrics
            </div>
            <div className="bg-orange-50 border-l-4 border-[#F27024] p-3 space-y-1 text-xs md:text-sm">
              <div className="flex justify-between"><span>GS Slant Range:</span><span className="text-green-400 font-mono text-xs">{metrics.gslantRange.toFixed(2)} km</span></div>
              <div className="flex justify-between"><span>UE Slant Range:</span><span className="text-green-400 font-mono text-xs">{metrics.ueslantRange.toFixed(2)} km</span></div>
              <div className="flex justify-between"><span>Doppler:</span><span className="text-green-400 font-mono text-xs">{metrics.doppler.toFixed(3)} kHz</span></div>
              <div className="flex justify-between"><span>Latency:</span><span className="text-green-400 font-mono text-xs">{metrics.latency.toFixed(3)} ms</span></div>
              <div className="flex justify-between"><span>Sat Speed:</span><span className="text-green-400 font-mono text-xs">{metrics.satSpeed.toFixed(2)} km/s</span></div>
              <div className="border-t border-orange-200 mt-2 pt-2">
                <div className="flex justify-between"><span>TA UE:</span><span className="text-green-400 font-mono text-xs">{(metrics.taUE ?? 0).toFixed(3)} µs</span></div>
                <div className="flex justify-between"><span>TA Common:</span><span className="text-green-400 font-mono text-xs">{(metrics.taCommon ?? 0).toFixed(3)} µs</span></div>
                <div className="flex justify-between"><span>RTT:</span><span className="text-green-400 font-mono text-xs">{(metrics.rtt ?? 0).toFixed(3)} ms</span></div>
              </div>
            </div>
          </div>

          {/* Orbit Classification */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm md:text-base font-semibold border-b border-cyan-500/50 pb-2">
              <Satellite className="w-4 h-4" />
              Orbit Classification
            </div>
            <div className="bg-orange-50 border-l-4 border-[#F27024] p-3 space-y-2 text-xs md:text-sm">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#00ff00' }} /><span>LEO: &lt; 2,000 km</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ff9500' }} /><span>MEO: 2,000 – 35,786 km</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#230fd8' }} /><span>GEO: ~35,786 km</span></div>
            </div>
          </div>

          {/* Pass Analysis Output */}
          {(passAnalysis || isMobile) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm md:text-base font-semibold border-b border-cyan-500/50 pb-2">
                <Activity className="w-4 h-4" />
                Analysis Output
              </div>
              <div className="bg-orange-50 border-l-4 border-[#F27024] p-3 text-xs md:text-sm whitespace-pre-wrap break-words leading-relaxed">
                {passAnalysis}

                {(uePassItems.length > 1 || gnbPassItems.length > 1) && (
                  <details className="mt-3 bg-white border border-orange-200 rounded p-2">
                    <summary className="cursor-pointer font-semibold text-xs md:text-sm">Other pass times</summary>

                    {uePassItems.length > 1 && (
                      <div className="mt-2">
                        <label className="block text-xs font-semibold mb-1">UE additional passes</label>
                        <select
                          className="w-full border border-orange-200 rounded px-2 py-1 text-xs bg-white"
                          value={selectedUeOtherPassIndex}
                          onChange={(e) => setSelectedUeOtherPassIndex(parseInt(e.target.value, 10))}
                        >
                          {uePassItems.slice(1).map((pass, idx) => {
                            const absoluteIndex = idx + 1;
                            return (
                              <option key={`ue-${absoluteIndex}-${pass.peak.toISOString()}`} value={absoluteIndex}>
                                {`Pass #${absoluteIndex + 1} • ${formatPassOptionLabel(pass)}`}
                              </option>
                            );
                          })}
                        </select>
                        {uePassItems[selectedUeOtherPassIndex] && (
                          <div className="mt-1 text-xs text-gray-600">
                            {formatPassTimesOnly(uePassItems[selectedUeOtherPassIndex])}
                          </div>
                        )}
                      </div>
                    )}

                    {gnbPassItems.length > 1 && (
                      <div className="mt-3">
                        <label className="block text-xs font-semibold mb-1">gNB additional passes</label>
                        <select
                          className="w-full border border-orange-200 rounded px-2 py-1 text-xs bg-white"
                          value={selectedGnbOtherPassIndex}
                          onChange={(e) => setSelectedGnbOtherPassIndex(parseInt(e.target.value, 10))}
                        >
                          {gnbPassItems.slice(1).map((pass, idx) => {
                            const absoluteIndex = idx + 1;
                            return (
                              <option key={`gnb-${absoluteIndex}-${pass.peak.toISOString()}`} value={absoluteIndex}>
                                {`Pass #${absoluteIndex + 1} • ${formatPassOptionLabel(pass)}`}
                              </option>
                            );
                          })}
                        </select>
                        {gnbPassItems[selectedGnbOtherPassIndex] && (
                          <div className="mt-1 text-xs text-gray-600">
                            {formatPassTimesOnly(gnbPassItems[selectedGnbOtherPassIndex])}
                          </div>
                        )}
                      </div>
                    )}
                  </details>
                )}

                {suitablePassDetails && (
                  <details className="mt-3 bg-white border border-orange-200 rounded p-2">
                    <summary className="cursor-pointer font-semibold text-xs md:text-sm">Suitable Pass Found</summary>
                    <div className="mt-2 whitespace-pre-wrap text-xs md:text-sm">{suitablePassDetails}</div>
                  </details>
                )}

                {centerPointDetails && (
                  <details className="mt-3 bg-white border border-orange-200 rounded p-2">
                    <summary className="cursor-pointer font-semibold text-xs md:text-sm">Equidistance to UE &amp; gNB</summary>
                    <div className="mt-2 whitespace-pre-wrap text-xs md:text-sm">{centerPointDetails}</div>
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* No Suitable Pass Modal */}
      {showNoSuitablePassModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6 space-y-4">
            <h2 className="text-lg md:text-xl font-bold text-gray-900">No Suitable Passes Found</h2>
            <p className="text-sm md:text-base text-gray-700 whitespace-pre-line">{noSuitablePassReason}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowNoSuitablePassModal(false)}
                className="px-4 py-2 bg-[#F27024] text-white rounded font-semibold hover:bg-orange-600 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
