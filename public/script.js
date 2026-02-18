const uploadInput = document.getElementById('upload');
const uploadBtn = document.getElementById('uploadBtn');
const videoList = document.getElementById('videoList');
const selectedVideo = document.getElementById('selectedVideo');
const streamKeyInput = document.getElementById('streamkey');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const loopToggle = document.getElementById('loopToggle');
const loopDot = document.getElementById('loopDot');
const statusText = document.getElementById('statusText');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const dropZone = document.getElementById('dropZone');
const liveIndicator = document.getElementById('liveIndicator');

let isLooping = false;
let uptimeInterval = null;
let statsInterval = null;
let startTime = null;

// --- Event Listeners ---

loopToggle.addEventListener('click', () => {
    isLooping = !isLooping;
    loopToggle.classList.toggle('bg-indigo-600', isLooping);
    loopToggle.classList.toggle('bg-gray-300', !isLooping);
    loopDot.classList.toggle('translate-x-5', isLooping);
    loopDot.classList.toggle('translate-x-1', !isLooping);
});

uploadInput.addEventListener('change', () => {
    if (uploadInput.files.length > 0) {
        fileNameDisplay.textContent = uploadInput.files[0].name;
        fileNameDisplay.classList.add('text-indigo-600', 'font-semibold');
    }
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-500', 'bg-indigo-50');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');
    if (e.dataTransfer.files.length > 0) {
        uploadInput.files = e.dataTransfer.files;
        fileNameDisplay.textContent = e.dataTransfer.files[0].name;
        fileNameDisplay.classList.add('text-indigo-600', 'font-semibold');
    }
});

uploadBtn.addEventListener('click', handleUpload);
startBtn.addEventListener('click', startStream);
stopBtn.addEventListener('click', stopStream);

// --- Core Functions ---

async function fetchVideos() {
    try {
        const response = await fetch('/videos');
        const videos = await response.json();
        
        videoList.innerHTML = videos.length === 0 ? '<p class="text-gray-400 text-center py-4">No videos uploaded yet</p>' : '';
        selectedVideo.innerHTML = '<option value="">-- Choose from Library --</option>';
        
        videos.forEach(video => {
            const div = document.createElement('div');
            div.className = 'flex items-center justify-between p-3 bg-white rounded-xl border border-gray-100 hover:shadow-md transition-shadow';
            div.innerHTML = `
                <div class="flex items-center space-x-3 overflow-hidden">
                    <i class="fas fa-video text-indigo-400"></i>
                    <div class="flex flex-col overflow-hidden">
                        <span class="text-sm font-medium text-gray-700 truncate">${video.name}</span>
                        <span class="text-xs text-gray-400">${video.size}</span>
                    </div>
                </div>
                <button onclick="deleteVideo('${video.name}')" class="text-red-400 hover:text-red-600 p-2 rounded-full transition-colors">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;
            videoList.appendChild(div);

            const option = document.createElement('option');
            option.value = video.name;
            option.textContent = video.name;
            selectedVideo.appendChild(option);
        });
    } catch (error) {
        console.error('Error fetching videos:', error);
        showToast('Could not load video library.', 'error');
    }
}

async function handleUpload() {
    const file = uploadInput.files[0];
    if (!file) {
        showToast('Please select a file to upload!', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('video', file);

    setUploadState(true);

    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        if (response.ok) {
            showToast('Video uploaded successfully!', 'success');
            resetUploadUI();
            fetchVideos();
        } else {
            const data = await response.json();
            showToast(data.error || 'Upload failed!', 'error');
        }
    } catch (error) {
        showToast('Error uploading video', 'error');
    } finally {
        setUploadState(false);
    }
}

async function deleteVideo(filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    
    try {
        const response = await fetch(`/videos/${filename}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('Video deleted!', 'success');
            fetchVideos();
        } else {
            showToast('Failed to delete video.', 'error');
        }
    } catch (error) {
        showToast('Error deleting video', 'error');
    }
}

async function startStream() {
    const streamkey = streamKeyInput.value;
    const video = selectedVideo.value;

    if (!streamkey || !video) {
        showToast('Stream key and a selected video are required!', 'error');
        return;
    }

    setStreamState(true);

    try {
        const response = await fetch('/start-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamkey, video, loop: isLooping })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to start stream');
        }
        
        showToast('Streaming is now live!', 'success');
        startUptimeCounter();
        startStatsPolling();

    } catch (error) {
        showToast(error.message, 'error');
        setStreamState(false);
    }
}

async function stopStream() {
    try {
        const response = await fetch('/stop-stream', { method: 'POST' });
        if (response.ok) {
            showToast('Streaming stopped successfully!', 'success');
            setStreamState(false);
            stopUptimeCounter();
            stopStatsPolling();
        } else {
            showToast('Failed to stop stream.', 'error');
        }
    } catch (error) {
        showToast('Error stopping stream', 'error');
    }
}

// --- UI Helper Functions ---

function setStreamState(isStreaming) {
    startBtn.classList.toggle('hidden', isStreaming);
    stopBtn.classList.toggle('hidden', !isStreaming);
    liveIndicator.classList.toggle('hidden', !isStreaming);
    liveIndicator.classList.toggle('flex', isStreaming);
    statusText.textContent = isStreaming ? 'Live' : 'Offline';
    statusText.classList.toggle('text-green-500', isStreaming);
    statusText.classList.toggle('text-gray-400', !isStreaming);
}

function setUploadState(isUploading) {
    uploadBtn.disabled = isUploading;
    uploadBtn.innerHTML = isUploading ? '<i class="fas fa-spinner fa-spin mr-2"></i> Uploading...' : '<i class="fas fa-upload mr-2"></i> Upload Now';
}

function resetUploadUI() {
    uploadInput.value = '';
    fileNameDisplay.textContent = 'Click or drag video to upload';
    fileNameDisplay.classList.remove('text-indigo-600', 'font-semibold');
}

function startUptimeCounter() {
    startTime = Date.now();
    updateUptime();
    uptimeInterval = setInterval(updateUptime, 1000);
}

function stopUptimeCounter() {
    clearInterval(uptimeInterval);
    document.getElementById('uptimeText').textContent = '00:00:00';
}

function updateUptime() {
    const diff = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    document.getElementById('uptimeText').textContent = `${h}:${m}:${s}`;
}

function startStatsPolling() {
    fetchStats();
    statsInterval = setInterval(fetchStats, 3000);
}

function stopStatsPolling() {
    clearInterval(statsInterval);
    document.getElementById('cpuText').textContent = '0%';
    document.getElementById('memText').textContent = '0%';
}

async function fetchStats() {
    try {
        const response = await fetch('/stats');
        const data = await response.json();
        document.getElementById('cpuText').textContent = data.cpu + '%';
        document.getElementById('memText').textContent = data.memory + '%';
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600' };
    
    toast.className = `fixed bottom-5 right-5 flex items-center px-6 py-3 rounded-xl text-white font-semibold shadow-2xl z-50 transform translate-y-20 opacity-0 transition-all duration-300`;
    toast.style.backgroundColor = colors[type];
    toast.innerHTML = `<i class="fas ${icons[type]} mr-3"></i> ${message}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.remove('translate-y-20', 'opacity-0');
    }, 100);
    
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function toggleKey() {
    const eye = document.getElementById('eyeIcon');
    if (streamKeyInput.type === 'password') {
        streamKeyInput.type = 'text';
        eye.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        streamKeyInput.type = 'password';
        eye.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

// Initial Load
fetchVideos();
