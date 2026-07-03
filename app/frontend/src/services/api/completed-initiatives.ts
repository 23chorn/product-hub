import axios from 'axios';
import type { CompletedInitiativeSummary, CompletedInitiativeDetail } from '@pap/shared';
import { API_BASE_URL } from './base';

export const completedInitiativesApi = {
  async getCompletedInitiatives(): Promise<CompletedInitiativeSummary[]> {
    const response = await axios.get(`${API_BASE_URL}/api/completed-initiatives`);
    return response.data;
  },

  /** Admin-only review list — initiatives manually archived off the default list above. */
  async getArchivedInitiatives(): Promise<CompletedInitiativeSummary[]> {
    const response = await axios.get(`${API_BASE_URL}/api/completed-initiatives/archived`);
    return response.data;
  },

  async getCompletedInitiative(itemId: string, archived = false): Promise<CompletedInitiativeDetail> {
    const response = await axios.get(`${API_BASE_URL}/api/completed-initiatives/${itemId}`, { params: archived ? { archived: true } : undefined });
    return response.data;
  },

  async refreshCompletedInitiative(itemId: string, archived = false): Promise<CompletedInitiativeDetail & { refreshed: number; notFound: number }> {
    const response = await axios.post(`${API_BASE_URL}/api/completed-initiatives/${itemId}/refresh`, undefined, { params: archived ? { archived: true } : undefined });
    return response.data;
  },

  /** Update a work item's title and/or description in ADO and sync the local title. */
  async updateAdoWorkItem(
    itemId: string, adoId: number,
    updates: { title?: string; description?: string },
    archived = false
  ): Promise<CompletedInitiativeDetail> {
    const response = await axios.patch(
      `${API_BASE_URL}/api/completed-initiatives/${itemId}/work-items/${adoId}`,
      updates,
      { params: archived ? { archived: true } : undefined }
    );
    return response.data;
  },

  /** Permanently delete a work item from ADO and remove it from the local tracking table. */
  async deleteAdoWorkItem(itemId: string, adoId: number, archived = false): Promise<CompletedInitiativeDetail> {
    const response = await axios.delete(
      `${API_BASE_URL}/api/completed-initiatives/${itemId}/work-items/${adoId}`,
      { params: archived ? { archived: true } : undefined }
    );
    return response.data;
  },

  /** Add a manually authored test case to the latest qa_tests artifact for this initiative. */
  async addTestCase(
    itemId: string,
    data: { title: string; type: string; priority: string; description?: string },
    archived = false,
  ): Promise<CompletedInitiativeDetail> {
    const response = await axios.post(
      `${API_BASE_URL}/api/completed-initiatives/${itemId}/test-cases`,
      data,
      { params: archived ? { archived: true } : undefined },
    );
    return response.data;
  },

  /** Delete a test case by ID from the latest qa_tests artifact for this initiative. */
  async deleteTestCase(itemId: string, tcId: string, archived = false): Promise<CompletedInitiativeDetail> {
    const response = await axios.delete(
      `${API_BASE_URL}/api/completed-initiatives/${itemId}/test-cases/${encodeURIComponent(tcId)}`,
      { params: archived ? { archived: true } : undefined },
    );
    return response.data;
  },

  /** Admin-only — hides a completed initiative from the default Progress Tracker list. */
  async archiveCompletedInitiative(itemId: string): Promise<{ ok: true }> {
    const response = await axios.post(`${API_BASE_URL}/api/completed-initiatives/${itemId}/archive`);
    return response.data;
  },

  /** Admin-only — restores a manually archived initiative to the default list. */
  async unarchiveCompletedInitiative(itemId: string): Promise<{ ok: true }> {
    const response = await axios.post(`${API_BASE_URL}/api/completed-initiatives/${itemId}/unarchive`);
    return response.data;
  },
};
