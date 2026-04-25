import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BASE = import.meta.env.BASE_URL + 'assets/';
const CARD_MATERIAL_NAME = 'Steel - Satin';
const TEXT_MATERIAL_NAME = 'Paint - Metallic (Black)';
const CAMERA_FIT_MARGIN = 0.95;

const sharedVector = new THREE.Vector3();
const modelCenter = new THREE.Vector3();
const boundingSphere = new THREE.Sphere();

export function initScene(container) {
  const params = new URLSearchParams(window.location.search);
  const shouldSpin = params.get('spin') !== 'none';
  let renderer;

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    container.innerHTML =
      '<p class="fallback-message">3D content is not supported on this device/browser.</p>';
    return { onResize: () => {} };
  }

  const getContainerSize = () => ({
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
  });
  const initialSize = getContainerSize();

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(initialSize.width, initialSize.height);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    38,
    initialSize.width / initialSize.height,
    0.01,
    100
  );
  camera.position.set(0, 0, 5);

  const ambientLight = new THREE.AmbientLight(0xfff4df, 0.62);
  scene.add(ambientLight);

  const hemisphereLight = new THREE.HemisphereLight(0xfff6e8, 0x3a342c, 1.05);
  scene.add(hemisphereLight);

  const keyLight = new THREE.DirectionalLight(0xfff2dd, 3.4);
  keyLight.position.set(-3.6, 3.2, 5.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.015;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const backLight = new THREE.DirectionalLight(0xfff2dd, 2.1);
  backLight.position.set(3.6, -3.2, -5.5);
  scene.add(backLight);
  scene.add(backLight.target);

  const rimLight = new THREE.DirectionalLight(0xfff0dc, 0.65);
  rimLight.position.set(3.8, -2.4, 3.6);
  scene.add(rimLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.45;
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.target.set(0, 0, 0);

  const textureLoader = new THREE.TextureLoader();
  const paperMap = textureLoader.load(BASE + 'texture.webp');
  paperMap.colorSpace = THREE.SRGBColorSpace;
  paperMap.wrapS = THREE.MirroredRepeatWrapping;
  paperMap.wrapT = THREE.MirroredRepeatWrapping;
  paperMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const cardMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xfffbf2,
    map: paperMap,
    roughness: 0.82,
    metalness: 0,
    clearcoat: 0.05,
    clearcoatRoughness: 0.72,
    side: THREE.DoubleSide,
  });

  const textMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x030303,
    roughness: 0.9,
    metalness: 0,
    clearcoat: 0.015,
    clearcoatRoughness: 0.9,
    side: THREE.DoubleSide,
  });

  const cardGroup = new THREE.Group();
  cardGroup.rotation.x = -Math.PI / 2;
  scene.add(cardGroup);

  const fbxLoader = new FBXLoader();
  let modelBounds = null;

  const getMaterialNames = (material) => {
    if (Array.isArray(material)) {
      return material.map((entry) => entry?.name ?? '').join(' ');
    }

    return material?.name ?? '';
  };

  const applyModelMaterials = (fbx) => {
    fbx.traverse((child) => {
      if (!child.isMesh) return;

      const materialNames = getMaterialNames(child.material);
      const isTextMesh = materialNames.includes(TEXT_MATERIAL_NAME);
      const isCardMesh =
        materialNames.includes(CARD_MATERIAL_NAME) ||
        child.name.toLowerCase().includes('card');

      child.material = isTextMesh ? textMaterial : cardMaterial;
      child.castShadow = isTextMesh;
      child.receiveShadow = true;

      if (!isCardMesh && !isTextMesh) {
        console.warn(`[scene] Unknown FBX material on "${child.name}"`);
      }
    });
  };

  const centerFbx = (fbx) => {
    fbx.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fbx);
    const center = box.getCenter(sharedVector);
    fbx.position.sub(center);
  };

  const updateModelBounds = () => {
    cardGroup.updateMatrixWorld(true);
    modelBounds = new THREE.Box3().setFromObject(cardGroup);
    modelBounds.getCenter(modelCenter);
    controls.target.copy(modelCenter);
    keyLight.target.position.copy(modelCenter);
    backLight.target.position.copy(modelCenter);
  };

  const fitCameraToModel = () => {
    if (!modelBounds) return;

    modelBounds.getBoundingSphere(boundingSphere);
    const radius = boundingSphere.radius;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fitHeightDistance = radius / Math.sin(fov / 2);
    const fitWidthDistance = fitHeightDistance / Math.min(camera.aspect, 1);
    const distance = Math.max(fitHeightDistance, fitWidthDistance) * CAMERA_FIT_MARGIN;

    camera.position.set(modelCenter.x, modelCenter.y, modelCenter.z + distance);
    camera.lookAt(modelCenter);
    camera.near = Math.max(distance / 150, 0.01);
    camera.far = distance * 80;
    camera.updateProjectionMatrix();

    controls.minDistance = distance;
    controls.maxDistance = distance * 2.5;
    controls.update();

    const shadowSize = radius * 1.6;
    keyLight.shadow.camera.left = -shadowSize;
    keyLight.shadow.camera.right = shadowSize;
    keyLight.shadow.camera.top = shadowSize;
    keyLight.shadow.camera.bottom = -shadowSize;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = distance * 4;
    keyLight.shadow.camera.updateProjectionMatrix();
  };

  fbxLoader.load(
    BASE + 'businesscard.fbx',
    (fbx) => {
      applyModelMaterials(fbx);
      centerFbx(fbx);
      cardGroup.add(fbx);
      updateModelBounds();
      fitCameraToModel();
      renderer.render(scene, camera);
      container.classList.add('is-ready');

      if (shouldSpin) {
        requestAnimationFrame(() => {
          controls.autoRotate = true;
        });
      }
    },
    undefined,
    (error) => {
      console.error('Error loading businesscard.fbx:', error);
      container.innerHTML =
        '<p class="fallback-message">Failed to load 3D model.</p>';
    }
  );

  function animate() {
    controls.update();
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(animate);

  function onResize() {
    const { width, height } = getContainerSize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    fitCameraToModel();
  }

  return { onResize };
}
