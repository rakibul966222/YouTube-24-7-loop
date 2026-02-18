import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

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
    const files = fs.readdirSync(uploadDir).map(file => ({
      name: file,
      path: path.join('uploads', file)
    }));
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

// Start streaming
server.post('/start-stream', (req, res) => {
  const { streamkey, video, loop, quality, bitrate } = req.body;

  if (!video) {
    return res.status(400).send({ error: 'Video file is required!' });
  }

  const filePath = path.join(uploadDir, video);
  if (!fs.existsSync(filePath)) {
    return res.status(400).send({ error: 'Video file not found!' });
  }

  if (streamProcess) {
    streamProcess.kill();
  }

  // Quality Presets
  const resolutions = {
    '480p': '854x480',
    '720p': '1280x720',
    '1080p': '1920x1080',
    '2k': '2560x1440',
    '4k': '3840x2160'
  };

  const resolution = resolutions[quality] || '1280x720';
  const targetBitrate = bitrate || '3000k';

  const ffmpegCommand = [
    'ffmpeg',
    ...(loop ? ['-stream_loop', '-1'] : []), // Loop enabled if requested
    '-re',
    '-i', filePath,
    '-vcodec', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-s', resolution,
    '-b:v', targetBitrate,
    '-maxrate', targetBitrate,
    '-bufsize', (parseInt(targetBitrate) * 2) + 'k',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    `rtmp://a.rtmp.youtube.com/live2/${streamkey}`
  ];

  console.log('Starting FFmpeg with command:', ffmpegCommand.join(' '));

  streamProcess = spawn(ffmpegCommand[0], ffmpegCommand.slice(1));

  streamProcess.stdout.on('data', (data) => {
    // console.log(`stdout: ${data}`);
  });

  streamProcess.stderr.on('data', (data) => {
    // FFmpeg outputs status to stderr
    // console.error(`stderr: ${data}`);
  });

  streamProcess.on('close', (code) => {
    console.log(`Stream process exited with code ${code}`);
    streamProcess = null;
  });

  res.send({ message: 'Streaming started' });
});

// Stop streaming
server.post('/stop-stream', (req, res) => {
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
