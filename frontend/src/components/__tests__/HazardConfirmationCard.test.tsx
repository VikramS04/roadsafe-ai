import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HazardConfirmationCard } from '../HazardConfirmationCard';
import { HazardReport } from '../../types';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    voteHazard: vi.fn(),
  },
}));

const baseHazard: HazardReport = {
  id: 'haz-1',
  type: 'landslide',
  severity: 'high',
  edgeId: 'E12',
  lat: 25.5788,
  lng: 91.8933,
  status: 'unverified',
  confirmCount: 1,
  disputeCount: 0,
  clearCount: 0,
  note: 'Boulders blocking half the lane',
  deviceId: 'dev-reporter',
  reportedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  expiresAt: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
  source: 'community',
  isImported: false,
  userVote: null,
};

describe('HazardConfirmationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows hazard details, source, totals, and disables voting with explanation when GPS is unavailable', () => {
    const onRetry = vi.fn();
    render(
      <HazardConfirmationCard
        hazard={baseHazard}
        onClose={vi.fn()}
        userLocation={null}
        locationError="Permission denied"
        onRetryLocation={onRetry}
        onVoteCast={vi.fn()}
      />
    );

    expect(screen.getByText(/landslide/i)).toBeInTheDocument();
    expect(screen.getByText(/Community Driver Report/i)).toBeInTheDocument();
    expect(screen.getByText(/Boulders blocking half the lane/i)).toBeInTheDocument();
    expect(screen.getByTestId('confirm-count')).toHaveTextContent('1');
    expect(screen.getByTestId('dispute-count')).toHaveTextContent('0');
    expect(screen.getByText(/Location required to vote/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    const disputeBtn = screen.getByRole('button', { name: /Dispute/i });
    expect(confirmBtn).toBeDisabled();
    expect(disputeBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Enable \/ Retry Location/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prevents voting and shows out-of-range explanation when user is > 5 km away', () => {
    render(
      <HazardConfirmationCard
        hazard={baseHazard}
        onClose={vi.fn()}
        userLocation={{ lat: 26.9124, lng: 75.7873 }} // Jaipur, >1500 km away
        onVoteCast={vi.fn()}
      />
    );

    expect(screen.getByText(/Out of range/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Dispute/i })).toBeDisabled();
  });

  it('submits vote when nearby, refreshes displayed totals & status, and calls onVoteCast', async () => {
    (api.voteHazard as any).mockResolvedValueOnce({
      message: 'Vote recorded successfully.',
      statusChanged: true,
      newStatus: 'confirmed',
      confirmCount: 3,
      disputeCount: 0,
      clearCount: 0,
      userVote: 'yes',
      report: { ...baseHazard, status: 'confirmed', confirmCount: 3, disputeCount: 0 },
    });

    const onVoteCast = vi.fn();
    render(
      <HazardConfirmationCard
        hazard={baseHazard}
        onClose={vi.fn()}
        userLocation={{ lat: 25.58, lng: 91.894 }} // ~150m away
        onVoteCast={onVoteCast}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    await waitFor(() => {
      expect(api.voteHazard).toHaveBeenCalledWith('haz-1', {
        vote: 'yes',
        voter_latitude: 25.58,
        voter_longitude: 91.894,
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Hazard status updated to CONFIRMED/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('confirm-count')).toHaveTextContent('3');
    expect(onVoteCast).toHaveBeenCalledTimes(1);
  });

  it('distinguishes official imported alerts from community votes and handles duplicate vote errors', async () => {
    const err: any = new Error('This device has already voted on this hazard report.');
    err.status = 409;
    err.code = 'ALREADY_VOTED';
    (api.voteHazard as any).mockRejectedValueOnce(err);

    const officialHazard: HazardReport = {
      ...baseHazard,
      id: 'haz-official',
      source: 'ndma_sachet',
      isImported: true,
      areaDesc: 'Jaipur District',
    };

    render(
      <HazardConfirmationCard
        hazard={officialHazard}
        onClose={vi.fn()}
        userLocation={{ lat: 25.58, lng: 91.894 }}
        onVoteCast={vi.fn()}
      />
    );

    expect(screen.getByText(/Official Alert • NDMA SACHET/i)).toBeInTheDocument();
    expect(screen.getByText(/Community feedback separate from official source/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dispute/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already voted/i);
    });
  });

  it('resets error and voted message when switching to a different hazard', async () => {
    const err: any = new Error('Proximity validation failed');
    err.status = 403;
    err.code = 'PROXIMITY_ERROR';
    (api.voteHazard as any).mockRejectedValueOnce(err);

    const { rerender } = render(
      <HazardConfirmationCard
        hazard={baseHazard}
        onClose={vi.fn()}
        userLocation={{ lat: 25.58, lng: 91.894 }}
        onVoteCast={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    rerender(
      <HazardConfirmationCard
        hazard={{ ...baseHazard, id: 'haz-2', type: 'flooded_road' }}
        onClose={vi.fn()}
        userLocation={{ lat: 25.58, lng: 91.894 }}
        onVoteCast={vi.fn()}
      />
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/flooded road/i)).toBeInTheDocument();
  });
});
