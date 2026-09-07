import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface BimClippingPlaneDef {
  normal: { x: number; y: number; z: number };
  distance: number;
}

export interface BimCapturedViewpoint {
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    fieldOfView: number;
    projection: 'perspective' | 'orthographic';
  };
  clippingPlanes: BimClippingPlaneDef[];
  highlightedGuids: string[];
  hiddenGuids: string[];
}

export interface UseBimViewerOptions {
  containerRef?: React.RefObject<HTMLDivElement | null> | undefined;
  gltfUrl?: string | null | undefined;
  onElementSelect?: ((guid: string | null) => void) | undefined;
  onModelLoaded?: (() => void) | undefined;
  onError?: ((err: Error) => void) | undefined;
}

export interface UseBimViewerResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  error: string | null;
  selectedGuid: string | null;
  highlightedGuids: string[];
  hiddenGuids: string[];
  loadModel: (url: string) => Promise<void>;
  selectElement: (guid: string | null) => void;
  highlightGuids: (guids: string[], colorHex?: number) => void;
  clearHighlights: () => void;
  hideElement: (guid: string) => void;
  showAll: () => void;
  focusElement: (guid: string) => void;
  resetView: () => void;
  setClippingPlane: (plane: BimClippingPlaneDef | null) => void;
  captureViewpoint: () => BimCapturedViewpoint;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: OrbitControls | null;
}

export function useBimViewer(options: UseBimViewerOptions = {}): UseBimViewerResult {
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = options.containerRef ?? internalContainerRef;

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [highlightedGuids, setHighlightedGuids] = useState<string[]>([]);
  const [hiddenGuids, setHiddenGuids] = useState<string[]>([]);

  // Three.js instances stored in refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRootRef = useRef<THREE.Group | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // Mapping GUID to meshes & materials
  const guidMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
  const originalMaterialMapRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(
    new Map(),
  );
  const activeClippingPlanesRef = useRef<THREE.Plane[]>([]);

  // Internal Highlight logic
  const clearHighlightsInternal = useCallback(() => {
    for (const [mesh, origMat] of originalMaterialMapRef.current.entries()) {
      mesh.material = origMat;
    }
    setHighlightedGuids([]);
  }, []);

  const highlightGuidsInternal = useCallback(
    (guids: string[], colorHex: number = 0x3b82f6) => {
      clearHighlightsInternal();

      const customMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.2,
        side: THREE.DoubleSide,
        clippingPlanes: activeClippingPlanesRef.current,
      });

      const activeList: string[] = [];
      for (const guid of guids) {
        const meshes = guidMeshMapRef.current.get(guid);
        if (meshes) {
          for (const mesh of meshes) {
            mesh.material = customMat;
          }
          activeList.push(guid);
        }
      }
      setHighlightedGuids(activeList);
    },
    [clearHighlightsInternal],
  );

  // Public highlight methods
  const selectElement = useCallback(
    (guid: string | null) => {
      setSelectedGuid(guid);
      if (guid) {
        highlightGuidsInternal([guid]);
      } else {
        clearHighlightsInternal();
      }
      options.onElementSelect?.(guid);
    },
    [highlightGuidsInternal, clearHighlightsInternal, options],
  );

  const highlightGuids = useCallback(
    (guids: string[], colorHex?: number) => {
      highlightGuidsInternal(guids, colorHex);
    },
    [highlightGuidsInternal],
  );

  const clearHighlights = useCallback(() => {
    clearHighlightsInternal();
  }, [clearHighlightsInternal]);

  // Isolate / Hide / Show
  const hideElement = useCallback((guid: string) => {
    const meshes = guidMeshMapRef.current.get(guid);
    if (meshes) {
      for (const mesh of meshes) {
        mesh.visible = false;
      }
      setHiddenGuids((prev) => Array.from(new Set([...prev, guid])));
    }
  }, []);

  const showAll = useCallback(() => {
    for (const meshes of guidMeshMapRef.current.values()) {
      for (const mesh of meshes) {
        mesh.visible = true;
      }
    }
    setHiddenGuids([]);
  }, []);

  // Focus Element by GUID
  const focusElement = useCallback((guid: string) => {
    const meshes = guidMeshMapRef.current.get(guid);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!meshes || meshes.length === 0 || !camera || !controls) return;

    const box = new THREE.Box3();
    for (const mesh of meshes) {
      box.expandByObject(mesh);
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 2.0);

    const fov = camera.fov * (Math.PI / 180);
    const distance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.2;

    const direction = camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() < 0.001) direction.set(1, 1, 1).normalize();

    camera.position.copy(center).add(direction.multiplyScalar(distance));
    controls.target.copy(center);
    controls.update();
  }, []);

  // Reset View to Entire Model
  const resetView = useCallback(() => {
    const modelRoot = modelRootRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!modelRoot || !camera || !controls) return;

    const box = new THREE.Box3().setFromObject(modelRoot);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 5.0);

    const fov = camera.fov * (Math.PI / 180);
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

    camera.position.set(center.x + cameraZ * 0.8, center.y + cameraZ * 0.7, center.z + cameraZ);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
  }, []);

  // Clipping Plane
  const setClippingPlane = useCallback((planeDef: BimClippingPlaneDef | null) => {
    const renderer = rendererRef.current;
    if (!planeDef) {
      activeClippingPlanesRef.current = [];
      if (renderer) renderer.clippingPlanes = [];
    } else {
      const plane = new THREE.Plane(
        new THREE.Vector3(planeDef.normal.x, planeDef.normal.y, planeDef.normal.z).normalize(),
        planeDef.distance,
      );
      activeClippingPlanesRef.current = [plane];
      if (renderer) renderer.clippingPlanes = [plane];
    }

    // Apply to all indexed materials
    for (const [mesh, origMat] of originalMaterialMapRef.current.entries()) {
      if (Array.isArray(origMat)) {
        for (const m of origMat) {
          m.clippingPlanes = activeClippingPlanesRef.current;
          m.needsUpdate = true;
        }
      } else {
        origMat.clippingPlanes = activeClippingPlanesRef.current;
        origMat.needsUpdate = true;
      }
      if (mesh.material && !Array.isArray(mesh.material)) {
        mesh.material.clippingPlanes = activeClippingPlanesRef.current;
        mesh.material.needsUpdate = true;
      }
    }
  }, []);

  // Capture Viewpoint (BCF format)
  const captureViewpoint = useCallback((): BimCapturedViewpoint => {
    const camera = cameraRef.current ?? new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const controls = controlsRef.current;
    const target = controls ? controls.target : new THREE.Vector3(0, 0, 0);

    const clippingPlanes: BimClippingPlaneDef[] = activeClippingPlanesRef.current.map((p) => ({
      normal: { x: p.normal.x, y: p.normal.y, z: p.normal.z },
      distance: p.constant,
    }));

    return {
      camera: {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: target.x, y: target.y, z: target.z },
        up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
        fieldOfView: camera.fov,
        projection: 'perspective',
      },
      clippingPlanes,
      highlightedGuids,
      hiddenGuids,
    };
  }, [highlightedGuids, hiddenGuids]);

  // Load Model (.glb)
  const loadModel = useCallback(
    async (url: string) => {
      const scene = sceneRef.current;
      if (!scene) return;

      setLoading(true);
      setError(null);

      // Remove existing model if any
      if (modelRootRef.current) {
        scene.remove(modelRootRef.current);
        modelRootRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            (child.geometry as unknown as THREE.BufferGeometry).dispose();
            const mat = child.material as THREE.Material | THREE.Material[];
            if (Array.isArray(mat)) {
              for (const m of mat) {
                m.dispose();
              }
            } else if (mat) {
              mat.dispose();
            }
          }
        });
        modelRootRef.current = null;
      }

      guidMeshMapRef.current.clear();
      originalMaterialMapRef.current.clear();

      const loader = new GLTFLoader();

      try {
        const gltf = await loader.loadAsync(url);
        const root = gltf.scene;
        modelRootRef.current = root;

        root.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mesh = child as unknown as THREE.Mesh;
            const origMat = mesh.material;
            const mat: THREE.Material | THREE.Material[] = Array.isArray(origMat)
              ? origMat.map((m) => m.clone())
              : origMat.clone();
            mesh.material = mat;
            originalMaterialMapRef.current.set(mesh, mat);

            let guid = mesh.userData['ifcGuid'] as string | undefined;
            let p: THREE.Object3D | null = mesh.parent;
            while (!guid && p && p !== root) {
              if (p.userData['ifcGuid']) {
                guid = p.userData['ifcGuid'] as string;
                break;
              }
              p = p.parent;
            }

            if (guid) {
              mesh.userData['ifcGuid'] = guid;
              const list = guidMeshMapRef.current.get(guid) ?? [];
              list.push(mesh);
              guidMeshMapRef.current.set(guid, list);
            }
          }
        });

        scene.add(root);
        resetView();
        setLoading(false);
        options.onModelLoaded?.();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e.message);
        setLoading(false);
        options.onError?.(e);
      }
    },
    [resetView, options],
  );

  // Initialize Scene, Camera, Renderer, Controls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    sceneRef.current = scene;

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight1.position.set(50, 100, 50);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.4);
    dirLight2.position.set(-50, -50, -50);
    scene.add(dirLight2);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.6);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    // 3. Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    camera.position.set(20, 20, 20);
    cameraRef.current = camera;

    // 4. Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(
        Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2),
      );
      renderer.localClippingEnabled = true;
      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
    } catch {
      const mockCanvas = document.createElement('canvas');
      renderer = {
        domElement: mockCanvas,
        setSize: () => {},
        setPixelRatio: () => {},
        render: () => {},
        dispose: () => {},
        localClippingEnabled: true,
      } as unknown as THREE.WebGLRenderer;
      container.appendChild(mockCanvas);
      rendererRef.current = renderer;
    }

    // 5. OrbitControls
    let controls: OrbitControls | null = null;
    try {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.target.set(0, 0, 0);
      controlsRef.current = controls;
    } catch {
      // OrbitControls fallback for non-DOM environments
    }

    // 6. Animation loop
    const animate = () => {
      animationFrameIdRef.current = requestAnimationFrame(animate);
      if (controls) {
        controls.update();
      }
      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };
    animate();

    // 7. Resize Observer
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
    }

    // 8. Raycast Click Selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      if (!renderer || !camera || !modelRootRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(modelRootRef.current.children, true);

      if (intersects.length > 0) {
        for (const hit of intersects) {
          let current: THREE.Object3D | null = hit.object;
          while (current && current !== modelRootRef.current) {
            const guid = current.userData['ifcGuid'] as string | undefined;
            if (guid) {
              setSelectedGuid(guid);
              highlightGuidsInternal([guid]);
              options.onElementSelect?.(guid);
              return;
            }
            current = current.parent;
          }
        }
      }

      setSelectedGuid(null);
      clearHighlightsInternal();
      options.onElementSelect?.(null);
    };

    const domEl = renderer.domElement;
    domEl.addEventListener('click', handleClick);

    // Initial load if url present
    if (options.gltfUrl) {
      void loadModel(options.gltfUrl);
    }

    // Cleanup on unmount
    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      domEl.removeEventListener('click', handleClick);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
      }
      if (controls) {
        controls.dispose();
      }
      if (renderer) {
        renderer.dispose();
      }
      if (container.contains(domEl)) {
        container.removeChild(domEl);
      }
      scene.clear();
    };
  }, []);

  return {
    containerRef,
    loading,
    error,
    selectedGuid,
    highlightedGuids,
    hiddenGuids,
    loadModel,
    selectElement,
    highlightGuids,
    clearHighlights,
    hideElement,
    showAll,
    focusElement,
    resetView,
    setClippingPlane,
    captureViewpoint,
    scene: sceneRef.current,
    camera: cameraRef.current,
    renderer: rendererRef.current,
    controls: controlsRef.current,
  };
}
