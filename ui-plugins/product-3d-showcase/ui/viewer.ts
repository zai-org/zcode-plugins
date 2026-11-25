// 导出的网页展示包：index.html + viewer.js（本文件）+ model.js（window.SHOWCASE = {model, look, title}）。
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadModel, Studio } from "./scene.ts";

declare global { interface Window { SHOWCASE: { model: { format: "glb" | "gltf"; data: string }; look: any; title: string; autoRotate: boolean } } }

async function main() {
  const cfg = window.SHOWCASE;
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const studio = new Studio(canvas);
  studio.setModel(await loadModel(cfg.model));
  studio.setLook(cfg.look);
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    studio.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    studio.renderer.setSize(w, h, false);
    studio.frame({ name: "front", yaw: 30, pitch: 15, zoom: 1 }, w / h);
  };
  resize();
  const controls = new OrbitControls(studio.camera, canvas);
  controls.target.copy(studio.center);
  controls.enableDamping = true;
  controls.autoRotate = cfg.autoRotate;
  controls.autoRotateSpeed = 1.5;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = studio.radius * 1.2;
  controls.maxDistance = studio.radius * 8;
  addEventListener("resize", () => { const t = controls.target.clone(); const p = studio.camera.position.clone(); resize(); studio.camera.position.copy(p); controls.target.copy(t); });
  canvas.addEventListener("pointerdown", () => (controls.autoRotate = false));
  document.getElementById("loading")?.remove();
  const loop = () => { controls.update(); studio.renderer.render(studio.scene, studio.camera); requestAnimationFrame(loop); };
  loop();
}
main().catch((e) => { const l = document.getElementById("loading"); if (l) l.textContent = `Cannot show the model: ${e?.message ?? e}`; });
