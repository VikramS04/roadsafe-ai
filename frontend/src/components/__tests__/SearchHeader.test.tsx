import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SearchHeader } from '../SearchHeader';
import { ReportHazardModal } from '../ReportHazardModal';
import { LayerControls } from '../LayerControls';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    geocode: vi.fn(),
    reportHazard: vi.fn(),
  },
}));

const defaultProps = {
  onSelectOrigin: vi.fn(),
  onSelectDestination: vi.fn(),
  onSwapLocations: vi.fn(),
  selectedVehicle: 'car',
  onSelectVehicle: vi.fn(),
  objective: 'safest' as const,
  onToggleObjective: vi.fn(),
  currentOriginName: 'Shillong',
  currentDestinationName: 'Cherrapunji',
  onUseMyLocation: vi.fn(),
  isLocating: false,
  onSearchRoute: vi.fn(),
};

describe('SearchHeader Place Name Isolation (Task 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selecting a destination does not change the origin field and closes dropdown', async () => {
    (api.geocode as any).mockResolvedValueOnce({
      results: [
        { place_id: 'p1', name: 'Dawki', display_name: 'Dawki, Meghalaya', lat: 25.18, lng: 92.02 },
      ],
    });

    render(<SearchHeader {...defaultProps} />);

    const originInput = screen.getByLabelText('Origin location') as HTMLInputElement;
    const destInput = screen.getByLabelText('Destination location') as HTMLInputElement;

    fireEvent.focus(destInput);
    fireEvent.change(destInput, { target: { value: 'Daw' } });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Destination suggestions' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Dawki'));

    expect(originInput.value).toBe('Shillong');
    expect(destInput.value).toBe('Dawki');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(defaultProps.onSelectDestination).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Dawki', lat: 25.18, lng: 92.02 })
    );
    expect(defaultProps.onSelectOrigin).not.toHaveBeenCalled();
  });

  it('ignores stale geocode responses arriving after selection or newer query', async () => {
    let resolveFirst!: (val: any) => void;
    const firstPromise = new Promise((res) => {
      resolveFirst = res;
    });

    (api.geocode as any)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({
        results: [{ place_id: 'p2', name: 'Mawphlang', display_name: 'Mawphlang', lat: 25.44, lng: 91.74 }],
      });

    render(<SearchHeader {...defaultProps} />);
    const destInput = screen.getByLabelText('Destination location') as HTMLInputElement;

    // First query
    fireEvent.change(destInput, { target: { value: 'Da' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    // Second query before first resolves
    fireEvent.change(destInput, { target: { value: 'Maw' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(screen.getByText('Mawphlang')).toBeInTheDocument();
    });

    // Now stale first response arrives -> must be ignored!
    await act(async () => {
      resolveFirst({
        results: [{ place_id: 'p-stale', name: 'Dawki Stale', display_name: 'Dawki', lat: 25.18, lng: 92.02 }],
      });
    });

    expect(screen.queryByText('Dawki Stale')).not.toBeInTheDocument();
    expect(screen.getByText('Mawphlang')).toBeInTheDocument();
  });

  it('closes dropdown on Escape and blur, and never leaks into ReportHazardModal or LayerControls', async () => {
    (api.geocode as any).mockResolvedValueOnce({
      results: [{ place_id: 'p3', name: 'Pynursla', display_name: 'Pynursla', lat: 25.31, lng: 91.9 }],
    });

    render(
      <>
        <SearchHeader {...defaultProps} />
        <ReportHazardModal isOpen={true} onClose={vi.fn()} defaultLocation={{ lat: 25.4, lng: 91.85 }} onReportCreated={vi.fn()} />
        <LayerControls
          showHazards={true}
          onToggleHazards={vi.fn()}
          showWeather={true}
          onToggleWeather={vi.fn()}
          conditions={null}
          onCenterLocation={vi.fn()}
          onOpenReport={vi.fn()}
        />
      </>
    );

    const destInput = screen.getByLabelText('Destination location');
    fireEvent.change(destInput, { target: { value: 'Pyn' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(screen.getByText('Pynursla')).toBeInTheDocument();
    });

    fireEvent.keyDown(destInput, { key: 'Escape' });
    expect(screen.queryByText('Pynursla')).not.toBeInTheDocument();
    expect(screen.getByText('Report a Road Hazard')).toBeInTheDocument();
  });
});
