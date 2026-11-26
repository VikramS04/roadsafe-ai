const ADMIN_BASE = '/api/v1/admin';

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = getCookie('roadsafe_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'moderator';
}

export const adminApi = {
  async login(email: string, password: string): Promise<{ admin: AdminUser; csrfToken: string }> {
    return adminRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  async logout(): Promise<void> {
    await adminRequest('/auth/logout', { method: 'POST' });
  },
  async me(): Promise<{ admin: AdminUser; csrfToken: string }> {
    return adminRequest('/auth/me');
  },
  async getDashboard(): Promise<any> {
    return adminRequest('/dashboard');
  },
  async getHazards(params: Record<string, string | number | boolean | undefined>): Promise<any> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== false) qs.set(k, String(v));
    }
    return adminRequest(`/hazards?${qs.toString()}`);
  },
  async getHazardDetail(id: string): Promise<any> {
    return adminRequest(`/hazards/${id}`);
  },
  async createOfficialHazard(payload: {
    type: string;
    severity: string;
    latitude: number;
    longitude: number;
    note?: string;
    vehicleClasses?: string[];
    expiresAt?: string;
  }): Promise<any> {
    return adminRequest('/hazards', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateHazard(id: string, payload: Record<string, any>): Promise<any> {
    return adminRequest(`/hazards/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async bulkHazards(ids: string[], action: string, reason?: string): Promise<any> {
    return adminRequest('/hazards/bulk', { method: 'POST', body: JSON.stringify({ ids, action, reason }) });
  },
  async deleteHazard(id: string): Promise<any> {
    return adminRequest(`/hazards/${id}`, { method: 'DELETE' });
  },
  async getDevices(): Promise<any> {
    return adminRequest('/devices');
  },
  async updateDevice(deviceId: string, action: string): Promise<any> {
    return adminRequest(`/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    });
  },
  async getSettings(): Promise<any> {
    return adminRequest('/settings');
  },
  async updateSettings(payload: {
    confirmThreshold: number;
    clearThreshold: number;
    defaultExpiryHours: number;
    proximityRadiusKm: number;
    maxReportsPerHour: number;
  }): Promise<any> {
    return adminRequest('/settings', { method: 'PUT', body: JSON.stringify(payload) });
  },
  async getAuditLog(page = 1, limit = 30): Promise<any> {
    return adminRequest(`/audit?page=${page}&limit=${limit}`);
  },
  exportUrl(format: 'csv' | 'geojson', status = 'all'): string {
    return `${ADMIN_BASE}/export?format=${format}&status=${encodeURIComponent(status)}`;
  },
};
