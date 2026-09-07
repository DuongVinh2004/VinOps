import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

export interface BimMeasurementResult {
  distanceMeters: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  point1: { x: number; y: number; z: number };
  point2: { x: number; y: number; z: number };
}

export interface BimMeasurementToolProps {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  active: boolean;
  onToggle: () => void;
  onMeasureComplete?: ((result: BimMeasurementResult) => void) | undefined;
}

export function BimMeasurementTool({
  scene,
  camera,
  renderer,
  active,
  onToggle,
  onMeasureComplete,
}: BimMeasurementToolProps): React.JSX.Element {
  const [point1, setPoint1] = useState<THREE.Vector3 | null>(null);
  const [point2, setPoint2] = useState<THREE.Vector3 | null>(null);
  const [lastMeasurement, setLastMeasurement] = useState<BimMeasurementResult | null>(null);

  const measureGroupRef = useRef<THREE.Group | null>(null);

  // Initialize measurement group in Three.js scene
  useEffect(() => {
    if (!scene) return;
    const group = new THREE.Group();
    group.name = 'BimMeasurementGroup';
    scene.add(group);
    measureGroupRef.current = group;

    return () => {
      scene.remove(group);
      group.clear();
      measureGroupRef.current = null;
    };
  }, [scene]);

  // Clear measurement markers from scene
  const clearMeasurements = useCallback(() => {
    setPoint1(null);
    setPoint2(null);
    setLastMeasurement(null);

    const group = measureGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const obj = group.children[0];
      if (!obj) break;
      group.remove(obj);
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        (obj.geometry as unknown as THREE.BufferGeometry).dispose();
        const mat = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) {
          for (const m of mat) {
            m.dispose();
          }
        } else if (mat) {
          mat.dispose();
        }
      }
    }
  }, []);

  // When active is toggled off, clear visual items
  useEffect(() => {
    if (!active) {
      clearMeasurements();
    }
  }, [active, clearMeasurements]);

  // Add marker sphere at point
  const addMarker = useCallback((pos: THREE.Vector3, colorHex: number = 0x10b981) => {
    const group = measureGroupRef.current;
    if (!group) return;

    const geo = new THREE.SphereGeometry(0.06, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      depthTest: false,
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.renderOrder = 999;
    sphere.position.copy(pos);
    group.add(sphere);
  }, []);

  // Add line connecting p1 and p2
  const addLine = useCallback((p1: THREE.Vector3, p2: THREE.Vector3) => {
    const group = measureGroupRef.current;
    if (!group) return;

    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 3,
      depthTest: false,
    });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    group.add(line);
  }, []);

  // Click handler for 3D measurement with vertex snapping
  useEffect(() => {
    if (!active || !renderer || !camera || !scene) return;

    const domEl = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleCanvasClick = (event: MouseEvent) => {
      // Prevent raycasting if clicking on an overlay or if not left mouse button
      if (event.button !== 0) return;

      const rect = domEl.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // Intersect everything in scene except measurement helper group
      const candidates = scene.children.filter((c) => c !== measureGroupRef.current);
      const intersects = raycaster.intersectObjects(candidates, true);

      if (intersects.length === 0) return;

      const hit = intersects[0];
      if (!hit || !hit.point) return;

      let pickedPoint = hit.point.clone();

      // Vertex Snapping Logic (< 0.15m threshold)
      if (hit.object instanceof THREE.Mesh && hit.face) {
        const geom = hit.object.geometry as THREE.BufferGeometry;
        const posAttr = geom.getAttribute('position');
        if (posAttr) {
          const vA = new THREE.Vector3()
            .fromBufferAttribute(posAttr, hit.face.a)
            .applyMatrix4(hit.object.matrixWorld);
          const vB = new THREE.Vector3()
            .fromBufferAttribute(posAttr, hit.face.b)
            .applyMatrix4(hit.object.matrixWorld);
          const vC = new THREE.Vector3()
            .fromBufferAttribute(posAttr, hit.face.c)
            .applyMatrix4(hit.object.matrixWorld);

          const snapThreshold = 0.15; // 15cm snap threshold
          let closest = pickedPoint;
          let minD = Infinity;

          for (const v of [vA, vB, vC]) {
            const d = v.distanceTo(pickedPoint);
            if (d < minD && d < snapThreshold) {
              minD = d;
              closest = v;
            }
          }
          pickedPoint = closest;
        }
      }

      if (!point1) {
        // First point picked
        setPoint1(pickedPoint);
        addMarker(pickedPoint, 0x10b981); // Emerald
      } else if (!point2) {
        // Second point picked -> Complete measurement
        setPoint2(pickedPoint);
        addMarker(pickedPoint, 0xf59e0b); // Amber
        addLine(point1, pickedPoint);

        const dist = point1.distanceTo(pickedPoint);
        const dx = Math.abs(pickedPoint.x - point1.x);
        const dy = Math.abs(pickedPoint.y - point1.y);
        const dz = Math.abs(pickedPoint.z - point1.z);

        const result: BimMeasurementResult = {
          distanceMeters: Math.round(dist * 1000) / 1000,
          deltaX: Math.round(dx * 1000) / 1000,
          deltaY: Math.round(dy * 1000) / 1000,
          deltaZ: Math.round(dz * 1000) / 1000,
          point1: { x: point1.x, y: point1.y, z: point1.z },
          point2: { x: pickedPoint.x, y: pickedPoint.y, z: pickedPoint.z },
        };

        setLastMeasurement(result);
        onMeasureComplete?.(result);
      } else {
        // Click after full measurement -> Start new measurement
        clearMeasurements();
        setPoint1(pickedPoint);
        addMarker(pickedPoint, 0x10b981);
      }
    };

    domEl.addEventListener('click', handleCanvasClick);
    return () => {
      domEl.removeEventListener('click', handleCanvasClick);
    };
  }, [
    active,
    renderer,
    camera,
    scene,
    point1,
    point2,
    addMarker,
    addLine,
    clearMeasurements,
    onMeasureComplete,
  ]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '12px 18px',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        zIndex: 40,
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        minWidth: '320px',
      }}
    >
      {/* Active Toggle Button */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          backgroundColor: active ? '#2563eb' : '#334155',
          color: '#ffffff',
          border: 'none',
          borderRadius: '6px',
          padding: '8px 12px',
          fontWeight: 600,
          fontSize: '12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        📐 {active ? 'Đang bật Thước đo' : 'Bật Thước đo 3D'}
      </button>

      {/* Measurement Status & Results Display */}
      {active && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1 }}>
          {!point1 && !lastMeasurement && (
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              Nhấp điểm thứ nhất trên mô hình để bắt đầu đo...
            </span>
          )}

          {point1 && !point2 && (
            <span style={{ fontSize: '12px', color: '#34d399', fontWeight: 500 }}>
              ✓ Điểm 1 đã ghim. Nhấp điểm thứ 2 để đo khoảng cách...
            </span>
          )}

          {lastMeasurement && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
              <div>
                <span style={{ color: '#94a3b8', marginRight: '4px' }}>Khoảng cách:</span>
                <strong style={{ color: '#38bdf8', fontSize: '15px' }}>
                  {lastMeasurement.distanceMeters.toFixed(3)} m
                </strong>
                <span style={{ color: '#64748b', fontSize: '11px', marginLeft: '4px' }}>
                  ({(lastMeasurement.distanceMeters * 1000).toFixed(0)} mm)
                </span>
              </div>
              <div style={{ color: '#64748b', fontSize: '11px' }}>
                ΔX: {lastMeasurement.deltaX.toFixed(3)}m | ΔY: {lastMeasurement.deltaY.toFixed(3)}m
                | ΔZ: {lastMeasurement.deltaZ.toFixed(3)}m
              </div>
            </div>
          )}

          {/* Reset button */}
          {(point1 || lastMeasurement) && (
            <button
              type="button"
              onClick={clearMeasurements}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid #475569',
                color: '#94a3b8',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              Làm mới
            </button>
          )}
        </div>
      )}
    </div>
  );
}
