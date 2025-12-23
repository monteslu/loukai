/**
 * Format Utils Tests
 */

import { describe, it, expect } from 'vitest';
import { getFormatIcon, formatDuration, formatTime, formatFileSize } from './formatUtils.js';

describe('formatUtils', () => {
  describe('getFormatIcon', () => {
    it('should return lightning icon for m4a-stems format', () => {
      expect(getFormatIcon('m4a-stems')).toBe('⚡');
    });

    it('should return disc icon for cdg-archive format', () => {
      expect(getFormatIcon('cdg-archive')).toBe('💿');
    });

    it('should return disc icon for cdg-pair format', () => {
      expect(getFormatIcon('cdg-pair')).toBe('💿');
    });

    it('should return default music icon for unknown format', () => {
      expect(getFormatIcon('unknown')).toBe('🎵');
      expect(getFormatIcon('mp3')).toBe('🎵');
      expect(getFormatIcon('')).toBe('🎵');
    });

    it('should return default icon for null/undefined', () => {
      expect(getFormatIcon(null)).toBe('🎵');
      expect(getFormatIcon(undefined)).toBe('🎵');
    });
  });

  describe('formatDuration', () => {
    it('should format zero seconds as dash', () => {
      expect(formatDuration(0)).toBe('-');
    });

    it('should format null/undefined as dash', () => {
      expect(formatDuration(null)).toBe('-');
      expect(formatDuration(undefined)).toBe('-');
    });

    it('should format negative seconds as dash', () => {
      expect(formatDuration(-10)).toBe('-');
    });

    it('should format seconds less than 1 minute', () => {
      expect(formatDuration(5)).toBe('0:05');
      expect(formatDuration(30)).toBe('0:30');
      expect(formatDuration(59)).toBe('0:59');
    });

    it('should format exactly 1 minute', () => {
      expect(formatDuration(60)).toBe('1:00');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(65)).toBe('1:05');
      expect(formatDuration(125)).toBe('2:05');
      expect(formatDuration(185)).toBe('3:05');
    });

    it('should pad single digit seconds with zero', () => {
      expect(formatDuration(61)).toBe('1:01');
      expect(formatDuration(121)).toBe('2:01');
    });

    it('should format long durations', () => {
      expect(formatDuration(600)).toBe('10:00');
      expect(formatDuration(3600)).toBe('60:00');
      expect(formatDuration(3665)).toBe('61:05');
    });

    it('should handle decimal seconds by flooring', () => {
      expect(formatDuration(65.7)).toBe('1:05');
      expect(formatDuration(125.9)).toBe('2:05');
    });

    it('should format typical song durations', () => {
      expect(formatDuration(180)).toBe('3:00'); // 3 minutes
      expect(formatDuration(225)).toBe('3:45'); // 3:45
      expect(formatDuration(270)).toBe('4:30'); // 4:30
    });
  });

  describe('formatTime', () => {
    it('should format zero as 0:00.0', () => {
      expect(formatTime(0)).toBe('0:00.0');
    });

    it('should format null/undefined as 0:00.0', () => {
      expect(formatTime(null)).toBe('0:00.0');
      expect(formatTime(undefined)).toBe('0:00.0');
    });

    it('should format NaN as 0:00.0', () => {
      expect(formatTime(NaN)).toBe('0:00.0');
    });

    it('should format seconds less than 1 minute with tenths', () => {
      expect(formatTime(5.0)).toBe('0:05.0');
      expect(formatTime(5.5)).toBe('0:05.5');
      expect(formatTime(5.9)).toBe('0:05.9');
    });

    it('should format exactly 1 minute', () => {
      expect(formatTime(60)).toBe('1:00.0');
    });

    it('should format minutes, seconds, and tenths', () => {
      expect(formatTime(65.5)).toBe('1:05.5');
      expect(formatTime(125.7)).toBe('2:05.7');
    });

    it('should pad single digit seconds with zero', () => {
      expect(formatTime(61.5)).toBe('1:01.5');
      expect(formatTime(121.2)).toBe('2:01.2');
    });

    it('should extract tenths of seconds', () => {
      expect(formatTime(1.1)).toBe('0:01.1');
      expect(formatTime(1.5)).toBe('0:01.5');
      expect(formatTime(1.9)).toBe('0:01.9');
    });

    it('should floor tenths (not round)', () => {
      expect(formatTime(1.19)).toBe('0:01.1');
      expect(formatTime(1.99)).toBe('0:01.9');
    });

    it('should handle long durations', () => {
      expect(formatTime(3665.5)).toBe('61:05.5');
    });
  });

  describe('formatFileSize', () => {
    it('should format zero bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should format bytes (< 1 KB)', () => {
      expect(formatFileSize(1)).toBe('1 B');
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(2048)).toBe('2 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(10240)).toBe('10 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1 MB'); // 1024 * 1024
      expect(formatFileSize(2097152)).toBe('2 MB');
      expect(formatFileSize(5242880)).toBe('5 MB');
      expect(formatFileSize(10485760)).toBe('10 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1073741824)).toBe('1 GB'); // 1024^3
      expect(formatFileSize(2147483648)).toBe('2 GB');
      expect(formatFileSize(5368709120)).toBe('5 GB');
    });

    it('should round to 1 decimal place', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(1587200)).toBe('1.5 MB');
      expect(formatFileSize(1610612736)).toBe('1.5 GB');
    });

    it('should handle fractional sizes', () => {
      expect(formatFileSize(1126)).toBe('1.1 KB');
      expect(formatFileSize(1152921)).toBe('1.1 MB');
    });

    it('should format typical audio file sizes', () => {
      expect(formatFileSize(3145728)).toBe('3 MB'); // ~3 MB MP3
      expect(formatFileSize(10485760)).toBe('10 MB'); // ~10 MB M4A file
      expect(formatFileSize(52428800)).toBe('50 MB'); // ~50 MB high quality
    });
  });

  describe('integration scenarios', () => {
    it('should format a complete song info', () => {
      const duration = formatDuration(225); // 3:45
      const position = formatTime(125.5); // 2:05.5
      const size = formatFileSize(5242880); // 5 MB
      const icon = getFormatIcon('m4a-stems');

      expect(duration).toBe('3:45');
      expect(position).toBe('2:05.5');
      expect(size).toBe('5 MB');
      expect(icon).toBe('⚡');
    });

    it('should handle edge cases consistently', () => {
      // All functions should handle null/undefined/0 gracefully
      expect(formatDuration(0)).toBe('-');
      expect(formatTime(0)).toBe('0:00.0');
      expect(formatFileSize(0)).toBe('0 B');
      expect(getFormatIcon('')).toBe('🎵');
    });
  });
});
