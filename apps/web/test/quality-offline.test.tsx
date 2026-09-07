// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileSiteInspection } from '../src/mobile-site-inspection.js';
import { DailyLogSheet } from '../src/daily-log-sheet.js';
import { OfflineStorageEngine } from '../src/offline-storage-engine.js';
import type { DailyLog, Inspection, VinopsApiClient } from '../src/api.js';

afterEach(cleanup);

describe('MobileSiteInspection Tablet Component', () => {
  const mockInspections: readonly Inspection[] = [
    {
      id: 'insp-1',
      projectId: 'proj-1',
      code: 'BB-001',
      title: 'Kiểm tra cốt thép sàn tầng 3',
      status: 'In Progress',
      inspectionDate: '2026-09-07',
    },
  ];

  it('renders tablet checklist and toggles Pass/Fail buttons', () => {
    const submitChecklistResults = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      submitChecklistResults,
    } as unknown as VinopsApiClient;

    render(
      <MobileSiteInspection projectId="proj-1" client={mockClient} inspections={mockInspections} />,
    );

    expect(screen.getByTestId('mobile-site-inspection')).toBeTruthy();
    expect(screen.getByTestId('connection-status')).toBeTruthy();

    const passBtn = screen.getByTestId('btn-pass-rebar_diameter');
    const failBtn = screen.getByTestId('btn-fail-rebar_diameter');

    expect(passBtn).toBeTruthy();
    expect(failBtn).toBeTruthy();

    // Click Pass
    fireEvent.click(passBtn);
    expect(passBtn.style.color).toBe('rgb(255, 255, 255)'); // active

    // Click Fail
    fireEvent.click(failBtn);
    expect(failBtn.style.color).toBe('rgb(255, 255, 255)');
  });

  it('saves checklist results online via client', async () => {
    const submitChecklistResults = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      submitChecklistResults,
    } as unknown as VinopsApiClient;

    render(
      <MobileSiteInspection projectId="proj-1" client={mockClient} inspections={mockInspections} />,
    );

    fireEvent.click(screen.getByTestId('btn-pass-rebar_diameter'));
    fireEvent.click(screen.getByTestId('btn-save-inspection'));

    await waitFor(() => {
      expect(submitChecklistResults).toHaveBeenCalledWith('insp-1', [
        { item_key: 'rebar_diameter', result: 'Pass' },
      ]);
      expect(screen.getByTestId('status-message')).toHaveTextContent('Đã gửi kết quả');
    });
  });
});

describe('DailyLogSheet Electronic Log Component', () => {
  const mockDraftLog: DailyLog = {
    id: 'log-1',
    projectId: 'proj-1',
    contractPackageId: 'pkg-1',
    logDate: '2026-09-07',
    shiftCode: 'day',
    status: 'Draft',
    authorUnit: 'Chính',
    workSummary: 'Đổ bê tông sàn dầm trục 1-4',
    weather: [
      {
        id: 'w-1',
        dailyLogId: 'log-1',
        timeOfDay: 'morning',
        temperatureC: 28,
        weatherCondition: 'Sunny',
        rainfallMm: 0,
        windForce: 'Cấp 2',
        source: 'manual',
      },
    ],
    manpower: [
      {
        id: 'm-1',
        dailyLogId: 'log-1',
        tradeOrSubcontractor: 'Thợ cốt thép',
        skillLevel: 'Skilled',
        headcount: 12,
        hoursWorked: 8,
      },
    ],
    equipment: [
      {
        id: 'e-1',
        dailyLogId: 'log-1',
        equipmentName: 'Máy bơm bê tông 37m',
        equipmentType: 'Pump',
        quantity: 1,
        hoursWorked: 8,
        operationalStatus: 'Operational',
      },
    ],
  };

  it('renders daily log details, manpower, equipment, and triggers GPS weather crawl', async () => {
    const crawlDailyWeather = vi.fn().mockResolvedValue({
      ...mockDraftLog,
      weather: [
        ...mockDraftLog.weather!,
        {
          id: 'w-2',
          dailyLogId: 'log-1',
          timeOfDay: 'noon',
          temperatureC: 34,
          weatherCondition: 'Cloudy',
          rainfallMm: 0,
          windForce: 'Cấp 3',
          source: 'crawled',
        },
      ],
    });
    const mockClient = {
      crawlDailyWeather,
    } as unknown as VinopsApiClient;

    render(<DailyLogSheet projectId="proj-1" client={mockClient} initialLog={mockDraftLog} />);

    expect(screen.getByTestId('daily-log-sheet')).toBeTruthy();
    expect(screen.getByTestId('daily-log-status')).toHaveTextContent('BẢN NHÁP');
    expect(screen.getByTestId('weather-box-morning')).toHaveTextContent('28°C');
    expect(screen.getByTestId('manpower-list')).toHaveTextContent('Thợ cốt thép: 12');
    expect(screen.getByTestId('equipment-list')).toHaveTextContent('Máy bơm bê tông 37m: 1');

    // Click Crawl Weather button
    const crawlBtn = screen.getByTestId('btn-crawl-weather');
    fireEvent.click(crawlBtn);

    await waitFor(() => {
      expect(crawlDailyWeather).toHaveBeenCalledWith('log-1', {
        lat: 21.0285,
        lng: 105.8542,
      });
    });
  });

  it('freezes inputs and disables actions when status is Confirmed', () => {
    const mockConfirmedLog: DailyLog = {
      ...mockDraftLog,
      status: 'Confirmed',
      siteManagerSignedBy: 'user-sm',
      supervisorSignedBy: 'user-tvgs',
    };

    const mockClient = {} as unknown as VinopsApiClient;

    render(<DailyLogSheet projectId="proj-1" client={mockClient} initialLog={mockConfirmedLog} />);

    expect(screen.getByTestId('daily-log-status')).toHaveTextContent('ĐÃ KHÓA (CONFIRMED)');
    expect(screen.getByTestId('input-work-summary')).toBeDisabled();
    expect(screen.getByTestId('btn-crawl-weather')).toBeDisabled();
    expect(screen.queryByTestId('btn-save-summary')).toBeNull();
  });
});

describe('OfflineStorageEngine Unit Tests', () => {
  it('enqueues, retrieves, and flushes offline operations', async () => {
    const engine = new OfflineStorageEngine('test-device-01');
    engine.clearQueue();

    engine.enqueueOperation({
      operation_id: 'op-1',
      entity_type: 'daily_log',
      entity_temp_id: 'temp-log-1',
      command: 'create',
      payload: { log_date: '2026-09-07' },
      client_created_at: new Date().toISOString(),
    });

    const pending = engine.getPendingOperations();
    expect(pending.length).toBe(1);
    expect(pending[0]!.operation_id).toBe('op-1');

    // Mock API flush
    const syncOfflineBatch = vi.fn().mockResolvedValue({
      applied_count: 1,
      conflict_count: 0,
      operations: [{ operation_id: 'op-1', status: 'applied' }],
    });
    const mockClient = {
      syncOfflineBatch,
    } as unknown as VinopsApiClient;

    const flushResult = await engine.flushSyncQueue(mockClient, 'proj-1');
    expect(flushResult.syncedCount).toBe(1);
    expect(flushResult.conflictCount).toBe(0);
    expect(engine.getPendingOperations().length).toBe(0);
  });
});
