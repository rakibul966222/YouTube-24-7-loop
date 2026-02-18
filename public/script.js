const socket = io();

// UI Elements
const uploadInput = document.getElementById('upload');
const videoList = document.getElementById('videoList');
const selectedVideo = document.getElementById('selectedVideo');
const streamKeyInput = document.getElementById('streamkey');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const loopToggle = document.getElementById('loopToggle');
const loopDot = document.getElementById('loopDot');
const liveIndicator = document.getElementById('liveIndicator');
const historyList = document.getElementById('historyList');
const streamStatusBadge = document.getElementById('streamStatusBadge');
const healthBadge = document.getElementById('healthBadge');

// Charts
let bitrateChart, cpuChart;
const maxDataPoints = 20;
const chartData = {
    bitrate: Array(maxDataPoints).fill(0),
    cpu: Array(maxDataPoints).fill(0),
    labels: Array(maxDataPoints).fill('')
};

function initCharts() {
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: { 
            y: { beginAtZero: true, grid: { display: false }, ticks: { display: false } },
            x: { grid: { display: false }, ticks: { display: false } }
        },
        plugins: { legend: { display: false } },
        elements: { line: { tension: 0.4 }, point: { radius: 0 } }
    };

    bitrateChart = new Chart(document.getElementById('bitrateChart'), {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{ data: chartData.bitrate, borderColor: '#6366f1', borderWidth: 2, fill: true, backgroundColor: 'rgba(99, 102, 241, 0.1)' }]
        },
        options: commonOptions
    });

    cpuChart = new Chart(document.getElementById('cpuChart'), {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{ data: chartData.cpu, borderColor: '#f43f5e', borderWidth: 2, fill: true, backgroundColor: 'rgba(244, 63, 94, 0.1)' }]
        },
        options: commonOptions
    });
}

function updateCharts(bitrate, cpu) {
    chartData.bitrate.push(bitrate);
    chartData.bitrate.shift();
    chartData.cpu.push(cpu);
    chartData.cpu.shift();
    bitrateChart.update('none');
    cpuChart.update('none');
}

// State
let isLooping = false;
let uptimeInterval = null;
let statsInterval = null;
let startTime = null;

// Socket Events
socket.on('status-update', (data) => {
    streamStatusBadge.textContent = data.message;
    if (data.message.includes('Live')) {
        streamStatusBadge.className = 'text-[9px] font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-600 uppercase tracking-widest';
    } else if (data.message.includes('Reconnecting')) {
        streamStatusBadge.className = 'text-[9px] font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-600 uppercase tracking-widest';
    }
});

socket.on('stream-analytics', (data) => {
    if (data.bitrate) {
        document.getElementById('bitrateText').textContent = `${Math.round(data.bitrate)} kbps`;
        document.getElementById('currentBitrateVal').textContent = Math.round(data.bitrate);
    }
    if (data.health) {
        const healthText = document.getElementById('healthText');
        healthText.textContent = data.health;
        healthText.className = `text-sm font-bold ${data.health === 'Excellent' ? 'text-emerald-500' : 'text-amber-500'}`;
    }
    if (data.drops !== undefined) document.getElementById('dropText').textContent = data.drops;
});

socket.on('stream-status', (data) => {
    if (data.active) {
        setStreamState(true);
        startTime = new Date(data.startTime).getTime();
        startUptimeCounter();
        startStatsPolling();
    }
});

socket.on('stream-stopped', () => {
    setStreamState(false);
    stopUptimeCounter();
    stopStatsPolling();
    streamStatusBadge.textContent = 'Ready';
    streamStatusBadge.className = 'text-[9px] font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-500 uppercase tracking-widest';
});

socket.on('history-updated', fetchHistory);

// Core Functions
async function fetchStats() {
    try {
        const res = await fetch('/stats');
        const data = await res.json();
        document.getElementById('cpuText').textContent = data.cpu + '%';
        document.getElementById('currentCpuVal').textContent = data.cpu + '%';
        document.getElementById('memText').textContent = data.memory + '%';
        document.getElementById('netText').textContent = data.netSpeed + ' KB/s';
        updateCharts(data.bitrate || 0, data.cpu);
    } catch (e) {}
}

async function fetchVideos() {
    try {
        const res = await fetch('/videos');
        const videos = await res.json();
        videoList.innerHTML = videos.length === 0 ? '<p class="text-slate-400 text-center py-8 text-xs italic">No media found</p>' : '';
        selectedVideo.innerHTML = '<option value="">-- Select from Library --</option>';
        videos.forEach(v => {
            const div = document.createElement('div');
            div.className = 'flex items-center justify-between p-3 bg-white rounded-2xl border border-slate-100 hover:shadow-md transition-all group';
            div.innerHTML = `
                <div class="flex items-center space-x-3 overflow-hidden">
                    <div class="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                        <i class="fas fa-film text-slate-400 group-hover:text-indigo-500 text-xs"></i>
                    </div>
                    <div class="flex flex-col overflow-hidden">
                        <span class="text-[11px] font-bold text-slate-700 truncate">${v.name}</span>
                        <span class="text-[9px] text-slate-400 font-medium">${v.size}</span>
                    </div>
                </div>
                <button onclick="deleteVideo('${v.name}')" class="text-slate-300 hover:text-rose-500 p-2 transition-colors">
                    <i class="fas fa-trash-alt text-xs"></i>
                </button>
            `;
            videoList.appendChild(div);
            const opt = document.createElement('option');
            opt.value = v.name; opt.textContent = v.name;
            selectedVideo.appendChild(opt);
        });
    } catch (e) {}
}

async function fetchHistory() {
    try {
        const res = await fetch('/history');
        const history = await res.json();
        historyList.innerHTML = history.length === 0 ? '<tr><td colspan="4" class="py-8 text-center text-slate-400 text-xs italic">No session data</td></tr>' : '';
        history.forEach(h => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-slate-50/50 transition-colors';
            row.innerHTML = `
                <td class="px-6 py-4 font-bold text-slate-700 truncate max-w-[150px]">${h.video}</td>
                <td class="px-6 py-4 text-slate-500 text-[10px] font-medium">${new Date(h.date).toLocaleString()}</td>
                <td class="px-6 py-4 text-slate-500 font-medium">${formatDuration(h.duration)}</td>
                <td class="px-6 py-4">
                    <span class="px-2.5 py-1 rounded-full text-[9px] font-bold ${h.status === 'Success' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}">
                        ${h.status}
                    </span>
                </td>
            `;
            historyList.appendChild(row);
        });
    } catch (e) {}
}

function handleUpload() {
    const file = uploadInput.files[0];
    if (!file) return showToast('Select a file', 'error');
    const formData = new FormData();
    formData.append('video', file);
    const xhr = new XMLHttpRequest();
    const progressContainer = document.getElementById('uploadProgressContainer');
    progressContainer.classList.remove('hidden');
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const p = Math.round((e.loaded / e.total) * 100);
            document.getElementById('uploadProgressBar').style.width = p + '%';
            document.getElementById('uploadPercent').textContent = p + '%';
        }
    });
    xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
            progressContainer.classList.add('hidden');
            if (xhr.status === 200) { fetchVideos(); showToast('Uploaded!', 'success'); }
            else showToast('Failed', 'error');
        }
    };
    xhr.open('POST', '/upload');
    xhr.send(formData);
}

async function startStream() {
    const key = streamKeyInput.value;
    const video = selectedVideo.value;
    if (!key || !video) return showToast('Key & Video required', 'error');
    setStreamState(true);
    try {
        const res = await fetch('/start-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamkey: key, video, loop: isLooping })
        });
        if (res.ok) { startTime = Date.now(); startUptimeCounter(); startStatsPolling(); }
        else setStreamState(false);
    } catch (e) { setStreamState(false); }
}

async function stopStream() {
    await fetch('/stop-stream', { method: 'POST' });
    setStreamState(false);
    stopUptimeCounter();
    stopStatsPolling();
}

// Helpers
function setStreamState(isLive) {
    startBtn.classList.toggle('hidden', isLive);
    stopBtn.classList.toggle('hidden', !isLive);
    liveIndicator.classList.toggle('hidden', !isLive);
    liveIndicator.classList.toggle('flex', isLive);
}

function startUptimeCounter() {
    if (uptimeInterval) clearInterval(uptimeInterval);
    uptimeInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - startTime) / 1000);
        document.getElementById('uptimeText').textContent = formatDuration(diff);
    }, 1000);
}

function stopUptimeCounter() {
    clearInterval(uptimeInterval);
    document.getElementById('uptimeText').textContent = '00:00:00';
}

function startStatsPolling() {
    if (statsInterval) clearInterval(statsInterval);
    fetchStats();
    statsInterval = setInterval(fetchStats, 2000);
}

function stopStatsPolling() {
    clearInterval(statsInterval);
}

function formatDuration(s) {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
}

function showToast(m, t) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-8 right-8 px-6 py-3 rounded-2xl text-white font-bold shadow-2xl z-50 text-xs ${t === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`;
    toast.textContent = m;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function toggleKey() {
    const input = streamKeyInput;
    const icon = document.getElementById('eyeIcon');
    if (input.type === 'password') {
        input.type = 'text'; icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password'; icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

// Init
loopToggle.addEventListener('click', () => {
    isLooping = !isLooping;
    loopToggle.classList.toggle('bg-indigo-600', isLooping);
    loopDot.classList.toggle('translate-x-5', isLooping);
});
uploadInput.addEventListener('change', handleUpload);
startBtn.addEventListener('click', startStream);
stopBtn.addEventListener('click', stopStream);

initCharts();
fetchVideos();
fetchHistory();
startStatsPolling();
