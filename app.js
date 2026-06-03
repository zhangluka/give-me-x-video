/**
 * give-me-x-video — Frontend Logic
 */

const $ = (sel) => document.querySelector(sel);

// ─── State ─────────────────────────────────────────────────

const DEFAULT_API = 'https://give-me-x-video.zhangluuka.workers.dev';
let apiBase = localStorage.getItem('xdown_api') || DEFAULT_API;
let currentResults = null;

// ─── DOM ───────────────────────────────────────────────────

const urlInput = $('#url-input');
const pasteBtn = $('#paste-btn');
const downloadBtn = $('#download-btn');
const btnText = downloadBtn.querySelector('.btn-text');
const btnLoading = downloadBtn.querySelector('.btn-loading');
const errorMsg = $('#error-msg');
const results = $('#results');
const tweetInfo = $('#tweet-info');
const mediaGrid = $('#media-grid');
const apiUrlInput = $('#api-url');

// ─── Init ──────────────────────────────────────────────────

if (apiBase) {
  apiUrlInput.value = apiBase;
}

apiUrlInput.addEventListener('input', (e) => {
  apiBase = e.target.value.replace(/\/+$/, '');
  localStorage.setItem('xdown_api', apiBase);
});

// paste button
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text;
      urlInput.focus();
      autoResolve(text);
    }
  } catch {
    // clipboard access denied, ignore
  }
});

// input events
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleDownload();
  }
});

urlInput.addEventListener('paste', (e) => {
  setTimeout(() => {
    const val = urlInput.value.trim();
    if (val && isXUrl(val)) {
      autoResolve(val);
    }
  }, 50);
});

// download button
downloadBtn.addEventListener('click', handleDownload);

// ─── Helpers ───────────────────────────────────────────────

function isXUrl(text) {
  return /(?:x\.com|twitter\.com)\/\w+\/status\/\d+/.test(text) || /^https?:\/\/t\.co\//.test(text);
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
}

function hideError() {
  errorMsg.style.display = 'none';
}

function setLoading(loading) {
  downloadBtn.disabled = loading;
  btnText.style.display = loading ? 'none' : 'inline';
  btnLoading.style.display = loading ? 'inline' : 'none';
}

function formatBitrate(bps) {
  if (!bps) return '';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${(bps / 1_000).toFixed(0)} Kbps`;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── API Call ──────────────────────────────────────────────

async function resolveTweet(url) {
  if (!apiBase) {
    throw new Error('Please set your API Worker URL in Settings first.');
  }

  const resp = await fetch(`${apiBase}/api/resolve?url=${encodeURIComponent(url)}`);
  const data = await resp.json();

  if (!data.ok) {
    throw new Error(data.message || data.error || 'Failed to resolve tweet');
  }

  return data;
}

// ─── Auto-resolve on paste ─────────────────────────────────

let autoResolveTimer = null;

function autoResolve(url) {
  clearTimeout(autoResolveTimer);
  autoResolveTimer = setTimeout(() => {
    if (isXUrl(url)) {
      handleDownload();
    }
  }, 300);
}

// ─── Main Handler ──────────────────────────────────────────

async function handleDownload() {
  const url = urlInput.value.trim();

  if (!url) {
    showError('Please paste a video link first.');
    return;
  }

  if (!isXUrl(url)) {
    showError('That doesn\'t look like an X / Twitter link.');
    return;
  }

  if (!apiBase) {
    showError('Please set your API Worker URL in Settings first.');
    return;
  }

  hideError();
  setLoading(true);
  results.style.display = 'none';

  try {
    const data = await resolveTweet(url);
    currentResults = data;
    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

// ─── Render Results ────────────────────────────────────────

function renderResults(data) {
  // tweet info
  if (data.tweet?.author || data.tweet?.text) {
    tweetInfo.style.display = 'block';
    tweetInfo.querySelector('.tweet-author').textContent =
      data.tweet.author ? `@${data.tweet.author}` : '';
    tweetInfo.querySelector('.tweet-text').textContent =
      data.tweet.text || '';
  } else {
    tweetInfo.style.display = 'none';
  }

  // media
  mediaGrid.innerHTML = '';

  data.media.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'media-card';

    // thumbnail
    const thumbWrapper = document.createElement('div');
    thumbWrapper.className = 'media-thumb-wrapper';

    if (item.type === 'video' || item.type === 'animated_gif') {
      const video = document.createElement('video');
      video.src = `${apiBase}/api/proxy?url=${encodeURIComponent(item.url)}`;
      video.muted = true;
      video.loop = true;
      video.preload = 'metadata';
      video.playsInline = true;

      // play on hover (desktop)
      card.addEventListener('mouseenter', () => video.play().catch(() => {}));
      card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });

      thumbWrapper.appendChild(video);

      // badge
      const badge = document.createElement('span');
      badge.className = 'media-badge';
      badge.textContent = item.type === 'animated_gif' ? 'GIF' : 'Video';
      thumbWrapper.appendChild(badge);

      // duration
      if (item.duration) {
        const dur = document.createElement('span');
        dur.className = 'media-duration';
        dur.textContent = formatDuration(item.duration);
        thumbWrapper.appendChild(dur);
      }
    } else if (item.type === 'photo') {
      const img = document.createElement('img');
      img.src = item.url;
      img.loading = 'lazy';
      thumbWrapper.appendChild(img);

      const badge = document.createElement('span');
      badge.className = 'media-badge';
      badge.textContent = 'Photo';
      thumbWrapper.appendChild(badge);
    }

    card.appendChild(thumbWrapper);

    // actions
    const actions = document.createElement('div');
    actions.className = 'media-actions';

    if (item.type === 'video' || item.type === 'animated_gif') {
      // quality selector (if multiple variants)
      if (item.variants && item.variants.length > 1) {
        const qualityBar = document.createElement('div');
        qualityBar.className = 'quality-selector';

        item.variants.forEach((v, vi) => {
          const btn = document.createElement('button');
          btn.className = `quality-btn${vi === 0 ? ' active' : ''}`;
          const bitrateLabel = formatBitrate(v.bitrate);
          btn.textContent = bitrateLabel || `Option ${vi + 1}`;
          btn.dataset.url = v.url;

          btn.addEventListener('click', () => {
            qualityBar.querySelectorAll('.quality-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            // update download button
            downloadPrimary.dataset.videoUrl = v.url;
          });

          qualityBar.appendChild(btn);
        });

        actions.appendChild(qualityBar);
      }

      // download button
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn-primary';
      dlBtn.innerHTML = '<span class="btn-text"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download</span>';
      dlBtn.dataset.videoUrl = item.url;

      dlBtn.addEventListener('click', () => {
        const videoUrl = dlBtn.dataset.videoUrl;
        downloadVideo(videoUrl, `x_video_${data.tweet?.id || Date.now()}.mp4`);
      });

      actions.appendChild(dlBtn);

      // copy link button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-secondary';
      copyBtn.textContent = 'Copy Link';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.url);
          copyBtn.textContent = '✓ Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
        } catch {
          copyBtn.textContent = 'Failed';
          setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
        }
      });

      actions.appendChild(copyBtn);

      // reference for quality switching
      var downloadPrimary = dlBtn;
    } else if (item.type === 'photo') {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn-primary';
      dlBtn.innerHTML = '<span class="btn-text"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save Image</span>';
      dlBtn.addEventListener('click', () => {
        window.open(item.url, '_blank');
      });
      actions.appendChild(dlBtn);
    }

    card.appendChild(actions);
    mediaGrid.appendChild(card);
  });

  results.style.display = 'block';
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Download via proxy ────────────────────────────────────

function downloadVideo(videoUrl, filename) {
  // try to download via proxy for better mobile support
  const proxyUrl = `${apiBase}/api/proxy?url=${encodeURIComponent(videoUrl)}`;

  const a = document.createElement('a');
  a.href = proxyUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
