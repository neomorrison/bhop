/* ============================== [CORE] ==============================
   Renderer, scene, camera, sky and lighting.  Imported once; every other
   module adds meshes to `scene` and renders through `camera`/`renderer`.
   (Structure follows the hvh base project; the look is this game's own.)   */
import * as THREE from 'three';
import { SETTINGS } from './config.js';

export const app = document.getElementById('app');

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0a1c, 2200, 9000);

export const camera = new THREE.PerspectiveCamera(SETTINGS.fov, innerWidth / innerHeight, 1, 30000);
scene.add(camera);

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- sky ---------------- */
// A gradient shell rather than a flat clear colour: at speed the horizon band is
// most of what tells you which way is up.
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    top:    { value: new THREE.Color(0x070617) },
    mid:    { value: new THREE.Color(0x2a1a55) },
    horizon:{ value: new THREE.Color(0xff3f8e) },
    bottom: { value: new THREE.Color(0x05040e) },
  },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 top, mid, horizon, bottom; varying vec3 vP;
    void main(){
      float h = normalize(vP).y;
      vec3 c;
      if (h > 0.0) c = mix(mix(horizon, mid, smoothstep(0.0, 0.22, h)), top, smoothstep(0.18, 0.75, h));
      else         c = mix(horizon, bottom, smoothstep(0.0, 0.30, -h));
      gl_FragColor = vec4(c, 1.0);
    }`,
});
export const sky = new THREE.Mesh(new THREE.SphereGeometry(14000, 32, 20), skyMat);
sky.frustumCulled = false;
scene.add(sky);

/* ---------------- lighting ---------------- */
const hemi = new THREE.HemisphereLight(0x8fa6ff, 0x2a1038, 0.75); scene.add(hemi);

export const sun = new THREE.DirectionalLight(0xffd9f0, 1.15);
sun.position.set(-1400, 2400, 900);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 100; sun.shadow.camera.far = 6500;
sun.shadow.camera.left = -1500; sun.shadow.camera.right = 1500;
sun.shadow.camera.top = 1500; sun.shadow.camera.bottom = -1500;
sun.shadow.bias = -0.0012;
scene.add(sun); scene.add(sun.target);

/** Keep the shadow frustum around the player — the course is far too long to cover at once. */
export function followSun(x, y, z) {
  sun.target.position.set(x, y, z);
  sun.position.set(x - 1100, y + 1900, z + 700);
  sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
}

export function setFov(deg) { camera.fov = deg; camera.updateProjectionMatrix(); }
