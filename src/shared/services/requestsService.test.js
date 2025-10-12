/**
 * Requests Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as requestsService from './requestsService.js';

// Mock WebServer for testing
class MockWebServer {
  constructor() {
    this.songRequests = [];
    this.settings = {
      requestsEnabled: true,
      maxRequestsPerUser: 3,
    };
    this.io = null;
    this.addToQueue = vi.fn();
  }
}

describe('requestsService', () => {
  let webServer;

  beforeEach(() => {
    webServer = new MockWebServer();
  });

  describe('getRequests', () => {
    it('should return all song requests', () => {
      const mockRequests = [
        { id: 1, song: 'Song 1', status: 'pending' },
        { id: 2, song: 'Song 2', status: 'approved' },
      ];
      webServer.songRequests = mockRequests;

      const result = requestsService.getRequests(webServer);

      expect(result.success).toBe(true);
      expect(result.requests).toEqual(mockRequests);
      expect(result.settings).toEqual(webServer.settings);
    });

    it('should return empty array when no requests', () => {
      const result = requestsService.getRequests(webServer);

      expect(result.success).toBe(true);
      expect(result.requests).toEqual([]);
    });

    it('should handle errors gracefully', () => {
      // Simulate error by making songRequests throw
      Object.defineProperty(webServer, 'songRequests', {
        get: () => {
          throw new Error('Database error');
        },
      });

      const result = requestsService.getRequests(webServer);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('approveRequest', () => {
    it('should approve a pending request', async () => {
      const mockRequest = {
        id: 1,
        song: 'Test Song',
        requesterName: 'John',
        status: 'pending',
      };
      webServer.songRequests = [mockRequest];
      webServer.addToQueue.mockResolvedValue(true);

      const result = await requestsService.approveRequest(webServer, 1);

      expect(result.success).toBe(true);
      expect(result.request.status).toBe('queued');
      expect(webServer.addToQueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, song: 'Test Song' })
      );
    });

    it('should broadcast approval via Socket.IO', async () => {
      const mockRequest = { id: 1, song: 'Test Song', status: 'pending' };
      webServer.songRequests = [mockRequest];
      webServer.addToQueue.mockResolvedValue(true);
      webServer.io = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      await requestsService.approveRequest(webServer, 1);

      expect(webServer.io.to).toHaveBeenCalledWith('admin-clients');
      expect(webServer.io.to).toHaveBeenCalledWith('electron-apps');
      expect(webServer.io.emit).toHaveBeenCalledWith(
        'request-approved',
        expect.objectContaining({ id: 1, status: 'queued' })
      );
    });

    it('should return error when request not found', async () => {
      const result = await requestsService.approveRequest(webServer, 999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request not found');
      expect(webServer.addToQueue).not.toHaveBeenCalled();
    });

    it('should return error when request is not pending', async () => {
      const mockRequest = { id: 1, song: 'Test Song', status: 'approved' };
      webServer.songRequests = [mockRequest];

      const result = await requestsService.approveRequest(webServer, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request is not pending');
      expect(webServer.addToQueue).not.toHaveBeenCalled();
    });

    it('should handle queue errors gracefully', async () => {
      const mockRequest = { id: 1, song: 'Test Song', status: 'pending' };
      webServer.songRequests = [mockRequest];
      webServer.addToQueue.mockRejectedValue(new Error('Queue full'));

      const result = await requestsService.approveRequest(webServer, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue full');
    });
  });

  describe('rejectRequest', () => {
    it('should reject a pending request', () => {
      const mockRequest = {
        id: 1,
        song: 'Test Song',
        requesterName: 'John',
        status: 'pending',
      };
      webServer.songRequests = [mockRequest];

      const result = requestsService.rejectRequest(webServer, 1);

      expect(result.success).toBe(true);
      expect(result.request.status).toBe('rejected');
    });

    it('should broadcast rejection via Socket.IO', () => {
      const mockRequest = { id: 1, song: 'Test Song', status: 'pending' };
      webServer.songRequests = [mockRequest];
      webServer.io = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };

      requestsService.rejectRequest(webServer, 1);

      expect(webServer.io.to).toHaveBeenCalledWith('admin-clients');
      expect(webServer.io.to).toHaveBeenCalledWith('electron-apps');
      expect(webServer.io.emit).toHaveBeenCalledWith(
        'request-rejected',
        expect.objectContaining({ id: 1, status: 'rejected' })
      );
    });

    it('should return error when request not found', () => {
      const result = requestsService.rejectRequest(webServer, 999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request not found');
    });

    it('should return error when request is not pending', () => {
      const mockRequest = { id: 1, song: 'Test Song', status: 'approved' };
      webServer.songRequests = [mockRequest];

      const result = requestsService.rejectRequest(webServer, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request is not pending');
    });

    it('should handle errors gracefully', () => {
      // Simulate error by making find throw
      webServer.songRequests = {
        find: () => {
          throw new Error('Database error');
        },
      };

      const result = requestsService.rejectRequest(webServer, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('addRequest', () => {
    it('should add a new song request', () => {
      const requestData = {
        song: 'Test Song',
        artist: 'Test Artist',
        requesterName: 'John Doe',
      };

      const result = requestsService.addRequest(webServer, requestData);

      expect(result.success).toBe(true);
      expect(result.request).toBeDefined();
      expect(result.request.id).toBeDefined();
      expect(result.request.timestamp).toBeDefined();
      expect(result.request.status).toBe('pending');
      expect(result.request.song).toBe('Test Song');
      expect(result.request.artist).toBe('Test Artist');
      expect(result.request.requesterName).toBe('John Doe');
      expect(webServer.songRequests).toHaveLength(1);
    });

    it('should broadcast new request via Socket.IO', () => {
      webServer.io = {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      };
      const requestData = { song: 'Test Song', requesterName: 'John' };

      requestsService.addRequest(webServer, requestData);

      expect(webServer.io.to).toHaveBeenCalledWith('admin-clients');
      expect(webServer.io.to).toHaveBeenCalledWith('electron-apps');
      expect(webServer.io.emit).toHaveBeenCalledWith(
        'new-song-request',
        expect.objectContaining({ song: 'Test Song', status: 'pending' })
      );
    });

    it('should generate unique IDs for multiple requests', async () => {
      const request1 = requestsService.addRequest(webServer, { song: 'Song 1' });
      // Small delay to ensure unique timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));
      const request2 = requestsService.addRequest(webServer, { song: 'Song 2' });

      expect(request1.request.id).toBeDefined();
      expect(request2.request.id).toBeDefined();
      expect(request1.request.id).not.toBe(request2.request.id);
      expect(webServer.songRequests).toHaveLength(2);
    });

    it('should handle errors gracefully', () => {
      // Simulate error by making songRequests push throw
      webServer.songRequests = {
        push: () => {
          throw new Error('Storage full');
        },
      };

      const result = requestsService.addRequest(webServer, { song: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Storage full');
    });
  });

  describe('clearRequests', () => {
    it('should clear all song requests', () => {
      webServer.songRequests = [
        { id: 1, song: 'Song 1' },
        { id: 2, song: 'Song 2' },
        { id: 3, song: 'Song 3' },
      ];

      const result = requestsService.clearRequests(webServer);

      expect(result.success).toBe(true);
      expect(webServer.songRequests).toEqual([]);
    });

    it('should work on already empty requests list', () => {
      const result = requestsService.clearRequests(webServer);

      expect(result.success).toBe(true);
      expect(webServer.songRequests).toEqual([]);
    });

    it('should handle errors gracefully', () => {
      // Simulate error by making songRequests setter throw
      Object.defineProperty(webServer, 'songRequests', {
        set: () => {
          throw new Error('Permission denied');
        },
      });

      const result = requestsService.clearRequests(webServer);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });
  });

  describe('integration scenarios', () => {
    it('should handle full request lifecycle', async () => {
      // Add request
      const addResult = requestsService.addRequest(webServer, {
        song: 'Bohemian Rhapsody',
        artist: 'Queen',
        requesterName: 'John',
      });
      expect(addResult.success).toBe(true);
      const requestId = addResult.request.id;

      // Get requests
      const getResult = requestsService.getRequests(webServer);
      expect(getResult.success).toBe(true);
      expect(getResult.requests).toHaveLength(1);
      expect(getResult.requests[0].status).toBe('pending');

      // Approve request
      webServer.addToQueue.mockResolvedValue(true);
      const approveResult = await requestsService.approveRequest(webServer, requestId);
      expect(approveResult.success).toBe(true);
      expect(approveResult.request.status).toBe('queued');

      // Clear requests
      const clearResult = requestsService.clearRequests(webServer);
      expect(clearResult.success).toBe(true);
      expect(webServer.songRequests).toEqual([]);
    });

    it('should handle reject instead of approve', async () => {
      // Add request
      const addResult = requestsService.addRequest(webServer, {
        song: 'Test Song',
        requesterName: 'Jane',
      });
      const requestId = addResult.request.id;

      // Reject request
      const rejectResult = requestsService.rejectRequest(webServer, requestId);
      expect(rejectResult.success).toBe(true);
      expect(rejectResult.request.status).toBe('rejected');

      // Cannot approve after rejection
      const approveResult = await requestsService.approveRequest(webServer, requestId);
      expect(approveResult.success).toBe(false);
      expect(approveResult.error).toBe('Request is not pending');
    });

    it('should handle multiple pending requests', () => {
      // Add multiple requests
      requestsService.addRequest(webServer, { song: 'Song 1', requesterName: 'User 1' });
      requestsService.addRequest(webServer, { song: 'Song 2', requesterName: 'User 2' });
      requestsService.addRequest(webServer, { song: 'Song 3', requesterName: 'User 3' });

      const result = requestsService.getRequests(webServer);
      expect(result.success).toBe(true);
      expect(result.requests).toHaveLength(3);
      expect(result.requests.every((r) => r.status === 'pending')).toBe(true);
    });
  });
});
