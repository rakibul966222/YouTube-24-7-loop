import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import si from 'systeminformation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = express();
const uploadDir = path.join(__dirname, 'uploads');

// Create upload directory if it doesn't exist
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

server.use(express.static('public'));
server.use(express.json());

let streamProcess = null;
let currentStreamConfig = null;
let isAutoRestarting = false;

// Endpoint for video upload
server.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).send({ error: 'No file uploaded!' });
  }
  res.send({ message: 'File uploaded successfully!', filePath: req.file.filename });
});

// Endpoint to list uploaded videos
server.get('/videos', (req, res) => {
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

// Endpoint to delete an uploaded video
server.delete('/videos/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadDir, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.send({ message: 'Video deleted successfully!' });
  } else {
    res.status(404).send({ error: 'File not found!' });
  }
});

// Get System Stats
server.get('/stats', async (req, res) => {
    try {
        const cpu = await si.currentLoad();
        const mem = await si.mem();
        res.send({
            cpu: Math.round(cpu.currentLoad),
            memory: Math.round((mem.active / mem.total) * 100)
        });
    } catch (err) {
        res.status(500).send({ error: 'Failed to get stats' });
    }
});

// Start streaming
server.post('/start-stream', (req, res) => {
  const { streamkey, video, loop } = req.body;

  if (!video || !streamkey) {
    return res.status(400).send({ error: 'Video file and Stream Key are required!' });
  }

  const filePath = path.join(uploadDir, video);
  if (!fs.existsSync(filePath)) {
    return res.status(400).send({ error: 'Video file not found!' });
  }

  currentStreamConfig = { streamkey, video, loop };
  startFFmpeg();

  res.send({ message: 'Streaming started' });
});

function startFFmpeg() {
    if (streamProcess) {
        streamProcess.kill();
    }

    const { streamkey, video, loop } = currentStreamConfig;
    const filePath = path.join(uploadDir, video);

    // FFmpeg command with automatic resolution and bitrate (copying source where possible for efficiency)
    // We use -c:v libx264 for compatibility but let it auto-scale or use source settings
    const ffmpegCommand = [
        'ffmpeg',
        ...(loop ? ['-stream_loop', '-1'] : []),
        '-re',
        '-i', filePath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
        `rtmp://a.rtmp.youtube.com/live2/${streamkey}`
    ];

    console.log('Starting FFmpeg with command:', ffmpegCommand.join(' '));

    streamProcess = spawn(ffmpegCommand[0], ffmpegCommand.slice(1));

    streamProcess.on('close', (code) => {
        console.log(`Stream process exited with code ${code}`);
        streamProcess = null;
        
        // Auto-restart logic if it wasn't a manual stop
        if (!isAutoRestarting && currentStreamConfig) {
            console.log('Stream stopped unexpectedly, restarting in 5 seconds...');
            isAutoRestarting = true;
            setTimeout(() => {
                if (currentStreamConfig) {
                    startFFmpeg();
                }
                isAutoRestarting = false;
            }, 5000);
        }
    });

    streamProcess.stderr.on('data', (data) => {
        // You could parse FFmpeg output here for more detailed analytics
    });
}

// Stop streaming
server.post('/stop-stream', (req, res) => {
  currentStreamConfig = null; // Clear config to prevent auto-restart
  if (streamProcess) {
    streamProcess.kill('SIGINT');
    streamProcess = null;
    res.send({ message: 'Streaming stopped' });
  } else {
    res.status(400).send({ error: 'No active stream to stop' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
