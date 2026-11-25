// 面板与导出的查看器共用：影棚灯光、地面阴影、按包围盒自动取景。
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type Lighting = "studio" | "soft" | "dramatic";
export interface Look { lighting: Lighting; background: string; shadow: boolean; exposure: number }
export interface Angle { name: string; yaw: number; pitch: number; zoom: number }

export const ANGLE_PRESETS: Angle[] = [
  { name: "front", yaw: 0, pitch: 8, zoom: 1 },
  { name: "three-quarter-left", yaw: -35, pitch: 15, zoom: 1 },
  { name: "three-quarter-right", yaw: 35, pitch: 15, zoom: 1 },
  { name: "side", yaw: 90, pitch: 5, zoom: 1 },
  { name: "back", yaw: 180, pitch: 10, zoom: 1 },
  { name: "top", yaw: 20, pitch: 60, zoom: 1 },
];

/**
 * 面板的 CSP 禁止 fetch（connect-src 'none'），而 GLTFLoader 默认用 fetch 读 data:/blob: 资源。
 * 这里改用 <img> 加载贴图（img-src 允许 data:/blob:），并直接解码内联的 data: buffer。
 */
function noFetch(parser: any) {
  parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
  const decoded = new Map<number, ArrayBuffer>();
  return {
    name: "zcode_no_fetch",
    loadBufferView(index: number) {
      const view = parser.json.bufferViews[index];
      const buffer = parser.json.buffers[view.buffer];
      if (!buffer?.uri?.startsWith("data:")) return null;
      if (!decoded.has(view.buffer)) {
        const b64 = buffer.uri.slice(buffer.uri.indexOf(",") + 1);
        decoded.set(view.buffer, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
      }
      const start = view.byteOffset ?? 0;
      return Promise.resolve(decoded.get(view.buffer)!.slice(start, start + view.byteLength));
    },
  };
}

export function loadModel(data: { format: "glb" | "gltf"; data: string }): Promise<THREE.Group> {
  const loader = new GLTFLoader().register(noFetch);
  const payload: ArrayBuffer | string = data.format === "glb" ? Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0)).buffer : data.data;
  return new Promise((resolve, reject) => loader.parse(payload, "", (g) => resolve(g.scene), (e) => reject(e instanceof Error ? e : new Error(String((e as any)?.message ?? e)))));
}

export class Studio {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  root = new THREE.Group();
  ground: THREE.Mesh;
  lights = new THREE.Group();
  size = new THREE.Vector3(1, 1, 1);
  center = new THREE.Vector3();
  radius = 1;
  private env?: THREE.Texture;

  constructor(canvas?: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.env;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.root, this.ground, this.lights);
  }

  /** 放入模型：居中、底面贴地，所有网格投射阴影。 */
  setModel(model: THREE.Object3D) {
    this.root.clear();
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    this.root.add(model);
    box.setFromObject(this.root);
    box.getSize(this.size);
    box.getCenter(this.center);
    this.radius = Math.max(1e-3, box.getBoundingSphere(new THREE.Sphere()).radius);
    this.ground.scale.setScalar(this.radius * 12);
  }

  setLook(look: Look) {
    this.renderer.toneMappingExposure = look.exposure;
    this.lights.clear();
    const r = this.radius;
    const key = new THREE.DirectionalLight(0xffffff, look.lighting === "dramatic" ? 3.2 : look.lighting === "soft" ? 1.2 : 2.2);
    key.position.set(r * 2.2, r * 4, r * 2.5);
    key.castShadow = look.shadow;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    Object.assign(cam, { left: -r * 2, right: r * 2, top: r * 2, bottom: -r * 2, near: 0.01, far: r * 12 });
    cam.updateProjectionMatrix();
    key.shadow.radius = look.lighting === "soft" ? 8 : 4;
    key.shadow.bias = -0.0005;
    key.target = this.root;
    this.lights.add(key);
    if (look.lighting !== "dramatic") {
      const fill = new THREE.DirectionalLight(0xffffff, look.lighting === "soft" ? 0.9 : 0.6);
      fill.position.set(-r * 3, r * 1.5, r * 2);
      this.lights.add(fill);
    }
    const rim = new THREE.DirectionalLight(0xffffff, look.lighting === "dramatic" ? 2.5 : 0.8);
    rim.position.set(-r, r * 2, -r * 3);
    this.lights.add(rim);
    this.scene.environmentIntensity = look.lighting === "dramatic" ? 0.35 : look.lighting === "soft" ? 1.1 : 0.8;
    this.ground.visible = look.shadow;
    if (look.background === "transparent") { this.scene.background = null; this.renderer.setClearColor(0x000000, 0); }
    else { this.scene.background = new THREE.Color(look.background); this.renderer.setClearColor(look.background, 1); }
  }

  /** 按角度取景：相机绕模型中心，距离让包围球正好装进画面。 */
  frame(angle: Angle, aspect: number) {
    this.camera.aspect = aspect;
    const fov = (this.camera.fov * Math.PI) / 180;
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect));
    const dist = (this.radius / Math.sin(fit / 2)) * 1.08 / angle.zoom;
    const yaw = (angle.yaw * Math.PI) / 180, pitch = (angle.pitch * Math.PI) / 180;
    this.camera.position.set(this.center.x + dist * Math.sin(yaw) * Math.cos(pitch), this.center.y + dist * Math.sin(pitch), this.center.z + dist * Math.cos(yaw) * Math.cos(pitch));
    this.camera.near = dist / 100;
    this.camera.far = dist * 10;
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();
  }

  render(width: number, height: number) {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }
}
