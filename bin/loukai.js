#!/usr/bin/env node

/**
 * Loukai Karaoke - Standalone CLI
 * 
 * Starts a web server for browsing and requesting karaoke songs
 * without requiring Electron.
 * 
 * Usage: npx loukai [--port 3069] [--songs-dir ./songs]
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import Fuse from 'fuse.js';
import * as mm from 'music-metadata';
import { list } from 'tar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const port = parseInt(getArg('--port', '3069'), 10);
const songsDir = path.resolve(getArg('--songs-dir', process.cwd()));
const SUPPORTED_EXTS = new Set(['.kai', '.m4a', '.mp3', '.cdg', '.flac', '.ogg', '.wav']);

// ─── Song Scanner ──────────────────────────────────────────────

async function scanSongs(dir) {
  const songs = [];
  if (!fs.existsSync(dir)) {
    console.warn(`⚠️  Songs directory not found: ${dir}`);
    return songs;
  }

  const entries = [];
  
  function walkSync(d) {
    try {
      const items = fs.readdirSync(d, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(d, item.name);
        if (item.isDirectory()) {
          walkSync(fullPath);
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (SUPPORTED_EXTS.has(ext)) {
            entries.push(fullPath);
          }
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }
  
  walkSync(dir);
  
  // Group .cdg files with their .mp3 pairs — only keep .mp3 side
  const cdgSet = new Set(entries.filter(f => f.toLowerCase().endsWith('.cdg')));
  const mp3ForCdg = new Set();
  for (const cdg of cdgSet) {
    const mp3 = cdg.replace(/\.cdg$/i, '.mp3');
    if (entries.includes(mp3)) {
      mp3ForCdg.add(mp3);
    }
  }
  
  // Process files
  for (const filePath of entries) {
    const ext = path.extname(filePath).toLowerCase();
    
    // Skip .cdg files (we handle them through the .mp3 pair)
    if (ext === '.cdg') continue;
    
    try {
      let song;
      if (ext === '.kai') {
        song = await scanKaiFile(filePath);
      } else {
        song = await scanAudioFile(filePath);
      }
      if (song) songs.push(song);
    } catch (err) {
      // Skip files we can't read metadata from
    }
  }
  
  return songs;
}

async function scanKaiFile(filePath) {
  // .kai files are tar archives containing song.json with metadata
  return new Promise((resolve) => {
    let metadata = null;
    const chunks = [];
    
    list({
      file: filePath,
      onReadEntry: (entry) => {
        if (entry.path === 'song.json' || entry.path.endsWith('/song.json')) {
          entry.on('data', (chunk) => chunks.push(chunk));
          entry.on('end', () => {
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              metadata = {
                path: filePath,
                title: json.title || path.basename(filePath, '.kai'),
                artist: json.artist || 'Unknown Artist',
                album: json.album || null,
                year: json.year || null,
                genre: json.genre || null,
                duration: json.duration || null,
                format: 'kai',
              };
            } catch {}
          });
        } else {
          entry.resume(); // drain
        }
      },
    }).then(() => {
      resolve(metadata || {
        path: filePath,
        title: path.basename(filePath, '.kai'),
        artist: 'Unknown Artist',
        format: 'kai',
      });
    }).catch(() => {
      resolve({
        path: filePath,
        title: path.basename(filePath, '.kai'),
        artist: 'Unknown Artist',
        format: 'kai',
      });
    });
  });
}

async function scanAudioFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    const metadata = await mm.parseFile(filePath, { duration: true });
    return {
      path: filePath,
      title: metadata.common?.title || path.basename(filePath, ext),
      artist: metadata.common?.artist || 'Unknown Artist',
      album: metadata.common?.album || null,
      year: metadata.common?.year ? String(metadata.common.year) : null,
      genre: metadata.common?.genre?.[0] || null,
      duration: metadata.format?.duration || null,
      format: ext.replace('.', ''),
    };
  } catch {
    return {
      path: filePath,
      title: path.basename(filePath, ext),
      artist: 'Unknown Artist',
      format: ext.replace('.', ''),
    };
  }
}

// ─── Opaque Song IDs (don't expose file paths) ────────────────

const songPathToId = new Map();
const songIdToPath = new Map();

function generateSongId(songPath) {
  if (songPathToId.has(songPath)) return songPathToId.get(songPath);
  const hash = crypto.createHash('sha256').update(songPath).digest('base64url').slice(0, 16);
  const id = `song_${hash}`;
  songPathToId.set(songPath, id);
  songIdToPath.set(id, songPath);
  return id;
}

function sanitizeSong(song) {
  return {
    id: generateSongId(song.path),
    title: song.title || 'Unknown Title',
    artist: song.artist || 'Unknown Artist',
    duration: song.duration || null,
    format: song.format || null,
    album: song.album || null,
    year: song.year || null,
    genre: song.genre || null,
  };
}

// ─── Server ────────────────────────────────────────────────────

async function main() {
  console.log('🎤 Loukai Karaoke - Standalone Mode');
  console.log(`📂 Scanning for songs in: ${songsDir}`);
  
  const songs = await scanSongs(songsDir);
  console.log(`🎵 Found ${songs.length} songs`);
  
  let fuse = null;
  if (songs.length > 0) {
    fuse = new Fuse(songs, {
      keys: ['title', 'artist', 'album'],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true,
      findAllMatches: true,
    });
  }
  
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: true, methods: ['GET', 'POST'], credentials: true },
  });
  
  app.use(cors());
  app.use(express.json());
  
  // Serve static assets
  const webDistPath = path.join(__dirname, '..', 'src', 'web', 'dist');
  const staticPath = path.join(__dirname, '..', 'static');
  
  if (fs.existsSync(staticPath)) {
    app.use('/static', express.static(staticPath));
  }
  
  if (fs.existsSync(webDistPath)) {
    app.use('/admin', express.static(webDistPath));
  }
  
  // ─── API Routes ──────────────────────────────────────────────
  
  app.get('/api/info', (req, res) => {
    res.json({
      serverName: 'Loukai Karaoke',
      allowRequests: true,
      requireApproval: false,
      standalone: true,
    });
  });
  
  app.get('/api/state', (req, res) => {
    res.json({
      currentSong: null,
      playback: { isPlaying: false, position: 0, duration: 0 },
      queue: [],
      serverInfo: { serverName: 'Loukai Karaoke', allowRequests: true },
    });
  });
  
  app.get('/api/queue', (req, res) => {
    res.json({ queue: [], currentlyPlaying: null, total: 0 });
  });
  
  app.get('/api/letters', (req, res) => {
    const letterCounts = {};
    songs.forEach((song) => {
      const firstChar = (song.artist || 'Unknown').charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(firstChar) ? firstChar : '#';
      letterCounts[letter] = (letterCounts[letter] || 0) + 1;
    });
    
    res.json({
      letters: Object.keys(letterCounts).sort((a, b) => {
        if (a === '#') return 1;
        if (b === '#') return -1;
        return a.localeCompare(b);
      }),
      counts: letterCounts,
    });
  });
  
  app.get('/api/songs/letter/:letter', (req, res) => {
    const letter = req.params.letter;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    
    const letterSongs = songs.filter((song) => {
      const firstChar = (song.artist || 'Unknown').charAt(0).toUpperCase();
      const songLetter = /[A-Z]/.test(firstChar) ? firstChar : '#';
      return songLetter === letter;
    }).sort((a, b) => {
      const c = a.artist.localeCompare(b.artist);
      return c !== 0 ? c : a.title.localeCompare(b.title);
    });
    
    const totalSongs = letterSongs.length;
    const totalPages = Math.ceil(totalSongs / limit);
    const startIndex = (page - 1) * limit;
    
    res.json({
      songs: letterSongs.slice(startIndex, startIndex + limit).map(sanitizeSong),
      pagination: {
        currentPage: page,
        totalPages,
        totalSongs,
        songsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  });
  
  app.get('/api/songs', (req, res) => {
    const search = req.query.search || '';
    const limit = parseInt(req.query.limit) || 50;
    
    let results = songs;
    if (search && fuse) {
      results = fuse.search(search).map((r) => r.item);
    } else {
      results = [...songs].sort((a, b) => a.title.localeCompare(b.title));
    }
    
    res.json({
      songs: results.slice(0, limit).map(sanitizeSong),
      total: results.length,
      hasMore: results.length > limit,
    });
  });
  
  app.get('/api/search', (req, res) => {
    const query = req.query.q || '';
    const limit = parseInt(req.query.limit) || 20;
    
    if (!query.trim() || !fuse) {
      return res.json({ results: [] });
    }
    
    const results = fuse.search(query).slice(0, limit).map((r) => sanitizeSong(r.item));
    res.json({ results });
  });
  
  // Song request (acknowledge but no queue in standalone mode)
  app.post('/api/request', (req, res) => {
    const { songId, requesterName } = req.body;
    if (!songId || !requesterName) {
      return res.status(400).json({ error: 'Song ID and requester name are required' });
    }
    res.json({
      success: true,
      message: 'Song request noted! (Standalone mode — no playback queue)',
      requestId: Date.now(),
      status: 'noted',
    });
  });

  // Auth check (standalone = no auth needed)
  app.get('/admin/check-auth', (req, res) => {
    res.json({ passwordSet: false, authenticated: true });
  });
  
  // SPA fallback for React Router
  app.get('/', (req, res) => {
    const indexPath = path.join(webDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send('<h1>Loukai Karaoke</h1><p>Web UI not built. Run: npm run build:web</p>');
    }
  });
  
  app.get(/^\/admin\/.*/, (req, res) => {
    const indexPath = path.join(webDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Web UI not built.');
    }
  });
  
  // Socket.IO minimal setup
  io.on('connection', (socket) => {
    socket.on('identify', (data) => {
      if (data.type === 'web-ui') socket.join('web-clients');
      if (data.type === 'admin') socket.join('admin-clients');
    });
  });
  
  // ─── Start ───────────────────────────────────────────────────
  
  httpServer.listen(port, () => {
    const lanIp = getLanIp();
    console.log('');
    console.log(`🎤 Loukai Karaoke is running!`);
    console.log(`   Local:  http://localhost:${port}`);
    console.log(`   Remote: http://${lanIp}:${port}`);
    console.log(`   Admin:  http://localhost:${port}/admin`);
    console.log('');
    console.log(`   ${songs.length} songs loaded from ${songsDir}`);
    console.log('');
    console.log('   Press Ctrl+C to stop');
  });
}

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
