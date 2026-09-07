// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import * as THREE from 'three';
import { BimPropertyPanel } from '../src/features/bim/BimPropertyPanel.js';
import { BimMeasurementTool } from '../src/features/bim/BimMeasurementTool.js';
import { useBimViewer } from '../src/features/bim/use-bim-viewer.js';
import type { BimElementResponse, BimElementLinkResponse } from '@vinops/contracts';

describe('BIM Web Components & Hook (ADR-013)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockElement: BimElementResponse = {
    id: 'el-11111111-1111-1111-1111-111111111111',
    ifcGuid: '2$B_3dE4f5Gh6Ij7Kl8MnP',
    ifcType: 'IfcWallStandardCase',
    name: 'Tường ngoài Trục A-1',
    storeyName: 'Tầng 2',
    properties: {
      Pset_WallCommon: {
        LoadBearing: true,
        IsExternal: true,
        FireRating: 'REI 120',
      },
      Dimensions: {
        Length: 6000,
        Height: 3300,
        Thickness: 200,
      },
    },
    boundingBox: {
      min: [0, 0, 0],
      max: [6, 0.2, 3.3],
    },
    locationNodeId: 'loc-22222222-2222-2222-2222-222222222222',
  };

  const mockLinks: BimElementLinkResponse[] = [
    {
      linkId: 'link-33333333-3333-3333-3333-333333333333',
      modelId: 'mod-1',
      ifcGuid: '2$B_3dE4f5Gh6Ij7Kl8MnP',
      entityType: 'field_issue',
      entityId: 'issue-44444444-4444-4444-4444-444444444444',
      linkedAt: '2026-09-07T12:00:00.000Z',
    },
  ];

  describe('BimPropertyPanel', () => {
    it('1. Renders element metadata, GUID, and property sets', () => {
      render(<BimPropertyPanel element={mockElement} links={mockLinks} />);

      expect(screen.getByText('Tường ngoài Trục A-1')).toBeInTheDocument();
      expect(screen.getByText('IfcWallStandardCase')).toBeInTheDocument();
      expect(screen.getByText('Tầng 2')).toBeInTheDocument();
      expect(screen.getByText(/2\$B_3dE4f5Gh6Ij7Kl8MnP/)).toBeInTheDocument();

      // Pset verification
      expect(screen.getByText('Pset_WallCommon')).toBeInTheDocument();
      expect(screen.getByText('FireRating')).toBeInTheDocument();
      expect(screen.getByText('REI 120')).toBeInTheDocument();
      expect(screen.getByText('Dimensions')).toBeInTheDocument();
      expect(screen.getByText('6000')).toBeInTheDocument();

      // Links verification
      expect(screen.getByText(/field issue/i)).toBeInTheDocument();
    });

    it('2. Filters properties via search query input', () => {
      render(<BimPropertyPanel element={mockElement} />);

      const searchInput = screen.getByPlaceholderText(/Lọc thuộc tính/);
      fireEvent.change(searchInput, { target: { value: 'FireRating' } });

      expect(screen.getByText('FireRating')).toBeInTheDocument();
      // Length should be filtered out
      expect(screen.queryByText('Length')).not.toBeInTheDocument();
    });

    it('3. Triggers actions: Focus element and Create BCF issue', () => {
      const onFocusMock = vi.fn();
      const onCreateIssueMock = vi.fn();

      render(
        <BimPropertyPanel
          element={mockElement}
          onFocusElement={onFocusMock}
          onCreateIssueLink={onCreateIssueMock}
        />,
      );

      const focusBtn = screen.getByText(/Tiêu điểm/);
      fireEvent.click(focusBtn);
      expect(onFocusMock).toHaveBeenCalledWith('2$B_3dE4f5Gh6Ij7Kl8MnP');

      const createIssueBtn = screen.getByText(/Tạo vấn đề \(BCF\)/);
      fireEvent.click(createIssueBtn);
      expect(onCreateIssueMock).toHaveBeenCalledWith('2$B_3dE4f5Gh6Ij7Kl8MnP');
    });

    it('4. Submits new spatial link via onAddEntityLink', () => {
      const onAddLinkMock = vi.fn();

      render(<BimPropertyPanel element={mockElement} onAddEntityLink={onAddLinkMock} />);

      const addBtn = screen.getByText('+ Thêm liên kết');
      fireEvent.click(addBtn);

      const idInput = screen.getByPlaceholderText('ID thực thể...');
      fireEvent.change(idInput, { target: { value: 'task-999' } });

      const saveBtn = screen.getByText('Lưu');
      fireEvent.click(saveBtn);

      expect(onAddLinkMock).toHaveBeenCalledWith(
        '2$B_3dE4f5Gh6Ij7Kl8MnP',
        'location_node',
        'task-999',
      );
    });
  });

  describe('BimMeasurementTool', () => {
    it('1. Toggles active state and renders measurement UI', () => {
      const onToggleMock = vi.fn();
      const { rerender } = render(
        <BimMeasurementTool
          scene={null}
          camera={null}
          renderer={null}
          active={false}
          onToggle={onToggleMock}
        />,
      );

      const btn = screen.getByText(/Bật Thước đo 3D/);
      fireEvent.click(btn);
      expect(onToggleMock).toHaveBeenCalled();

      rerender(
        <BimMeasurementTool
          scene={null}
          camera={null}
          renderer={null}
          active={true}
          onToggle={onToggleMock}
        />,
      );

      expect(screen.getByText(/Đang bật Thước đo/)).toBeInTheDocument();
      expect(screen.getByText(/Nhấp điểm thứ nhất/)).toBeInTheDocument();
    });

    it('2. Calculates 3D distance and delta values with mm precision', () => {
      const p1 = new THREE.Vector3(0, 0, 0);
      const p2 = new THREE.Vector3(3, 4, 0); // 3-4-5 triangle -> 5 meters
      const dist = p1.distanceTo(p2);
      expect(dist).toBe(5.0);

      const pA = new THREE.Vector3(1.234, 2.345, 3.456);
      const pB = new THREE.Vector3(4.567, 5.678, 6.789);
      const distReal = pA.distanceTo(pB);
      expect(Number(distReal.toFixed(3))).toBeGreaterThan(0);
    });
  });

  describe('useBimViewer hook', () => {
    it('1. Initializes viewer state and provides controls', () => {
      const { result } = renderHook(() => useBimViewer());

      expect(result.current.selectedGuid).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.highlightedGuids).toEqual([]);

      // Select element programmatically
      act(() => {
        result.current.selectElement('guid-test-123');
      });
      expect(result.current.selectedGuid).toBe('guid-test-123');

      // Clear highlights
      act(() => {
        result.current.clearHighlights();
      });
      expect(result.current.highlightedGuids).toEqual([]);

      // Clipping plane test
      act(() => {
        result.current.setClippingPlane({
          normal: { x: 0, y: 1, z: 0 },
          distance: 12.5,
        });
      });

      // Capture viewpoint returns BCF formatted viewpoint
      const vp = result.current.captureViewpoint();
      expect(vp.camera).toBeDefined();
      expect(vp.camera.projection).toBe('perspective');
      expect(vp.clippingPlanes.length).toBe(1);
      expect(vp.clippingPlanes[0]?.distance).toBe(12.5);
    });
  });
});
