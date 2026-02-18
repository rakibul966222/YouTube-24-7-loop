import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import si from 'systeminformation';
import { Server } from 'socket.io';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, 'uploads');
const historyFile = path.join(__dirname, 'history.json');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, JSON.stringify([]));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

app.use(express.static('public'));
app.use(express.json());

let streamProcess = null;
let currentStreamConfig = null;
let isAutoRestarting = false;
let streamStartTime = null;
let lastActiveVideo = null;

// Advanced Monitoring State
let streamHealth = 'Excellent';
let frameDrops = 0;
let currentBitrate = 0;

io.on('connection', (socket) => {
  if (streamProcess) {
    socket.emit('stream-status', { 
        active: true, 
        startTime: streamStartTime, 
        video: lastActiveVideo,
        health: streamHealth 
    });
  }
});

app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).send({ error: 'No file uploaded!' });
  res.send({ message: 'File uploaded successfully!', filePath: req.file.filename });
});

app.get('/videos', (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir).map(file => {
        const stats = fs.statSync(path.join(uploadDir, file));
        return {
            name: file,
            path: path.join('uploads', file),
            size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
            createdAt: stats.birthtime
        };
    }).sort((a, b) => b.createdAt - a.createdAt);
    res.send(files);
  } catch (err) {
    res.status(500).send({ error: 'Failed to list videos' });
  }
});

app.delete('/videos/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.send({ message: 'Video deleted successfully!' });
  } else {
    res.status(404).send({ error: 'File not found!' });
  }
});

app.get('/stats', async (req, res) => {
    try {
        const cpu = await si.currentLoad();
        const mem = await si.mem();
        const network = await si.networkStats();
        res.send({
            cpu: Math.round(cpu.currentLoad),
            memory: Math.round((mem.active / mem.total) * 100),
            netSpeed: network[0] ? Math.round(network[0].tx_sec / 1024) : 0, // KB/s
            health: streamHealth,
            bitrate: currentBitrate
        });
    } catch (err) {
        res.status(500).send({ error: 'Failed to get stats' });
    }
});

app.get('/history', (req, res) => {
    try {
        const history = JSON.parse(fs.readFileSync(historyFile));
        res.send(history);
    } catch (err) {
        res.status(500).send({ error: 'Failed to get history' });
    }
});

app.post('/start-stream', (req, res) => {
  const { streamkey, video, loop } = req.body;
  if (!video || !streamkey) return res.status(400).send({ error: 'Missing parameters' });
  
  const filePath = path.join(uploadDir, video);
  if (!fs.existsSync(filePath)) return res.status(400).send({ error: 'File not found' });

  currentStreamConfig = { streamkey, video, loop };
  lastActiveVideo = video;
  streamStartTime = new Date();
  frameDrops = 0;
  streamHealth = 'Excellent';
  startFFmpeg();
  res.send({ message: 'Streaming started' });
});

function startFFmpeg() {
    if (streamProcess) streamProcess.kill();
    if (!currentStreamConfig) return;

    const { streamkey, video, loop } = currentStreamConfig;
    const filePath = path.join(uploadDir, video);

    // Advanced FFmpeg command with smart optimization
    const ffmpegCommand = [
        'ffmpeg',
        ...(loop ? ['-stream_loop', '-1'] : []),
        '-re',
        '-i', filePath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-maxrate', '8000k',
        '-bufsize', '16000k',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-f', 'flv',
        `rtmp://a.rtmp.youtube.com/live2/${streamkey}`
    ];

    io.emit('status-update', { message: `Live: ${video}` });
    streamProcess = spawn(ffmpegCommand[0], ffmpegCommand.slice(1));

    streamProcess.on('close', (code) => {
        if (streamStartTime) {
            const duration = Math.floor((new Date() - streamStartTime) / 1000);
            saveToHistory({
                video: lastActiveVideo,
                date: streamStartTime.toISOString(),
                duration: duration,
                status: code === 0 || code === 255 ? 'Success' : 'Failed'
            });
            streamStartTime = null;
        }
        streamProcess = null;
        if (!isAutoRestarting && currentStreamConfig) {
            isAutoRestarting = true;
            io.emit('status-update', { message: 'Auto-Reconnecting...' });
            setTimeout(() => {
                if (currentStreamConfig) startFFmpeg();
                isAutoRestarting = false;
            }, 5000);
        } else {
            io.emit('stream-stopped');
        }
    });

    streamProcess.stderr.on('data', (data) => {
        const output = data.toString();
        
        // Smart Health Analysis
        const bitrateMatch = output.match(/bitrate=\s*([\d.]+)\s*kbps/);
        const speedMatch = output.match(/speed=\s*([\d.]+)\s*x/);
        const dropMatch = output.match(/drop=\s*(\d+)/);

        if (bitrateMatch) currentBitrate = parseFloat(bitrateMatch[1]);
        if (dropMatch) {
            const newDrops = parseInt(dropMatch[1]);
            if (newDrops > frameDrops + 10) streamHealth = 'Unstable';
            else if (newDrops > frameDrops) streamHealth = 'Good';
            frameDrops = newDrops;
        }

        if (speedMatch && parseFloat(speedMatch[1]) < 0.9) streamHealth = 'Critical (Slow CPU)';

        if (bitrateMatch || speedMatch) {
            io.emit('stream-analytics', {
                bitrate: currentBitrate,
                speed: speedMatch ? speedMatch[1] : null,
                health: streamHealth,
                drops: frameDrops
            });
        }
    });
}

function saveToHistory(entry) {
    try {
        const history = JSON.parse(fs.readFileSync(historyFile));
        history.unshift(entry);
        if (history.length > 50) history.pop();
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
        io.emit('history-updated');
    } catch (err) {}
}

app.post('/stop-stream', (req, res) => {
  currentStreamConfig = null; 
  if (streamProcess) {
    streamProcess.kill('SIGINT');
    streamProcess = null;
    res.send({ message: 'Stopped' });
  } else res.status(400).send({ error: 'No active stream' });
});

server.listen(3000, () => console.log('Server running on port 3000'));
