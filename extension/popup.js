const card = document.getElementById('card');
const dot = document.getElementById('dot');
const statusText = document.getElementById('status');
const daemonVersion = document.getElementById('daemonVersion');
const profileRow = document.getElementById('profileRow');
const contextId = document.getElementById('contextId');
const copyBtn = document.getElementById('copyBtn');
const extVersion = document.getElementById('extVersion');
const bridgeUrl = document.getElementById('bridgeUrl');
const bridgeToken = document.getElementById('bridgeToken');
const saveBtn = document.getElementById('saveBtn');
const reconnectBtn = document.getElementById('reconnectBtn');

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp);
    });
  });
}

function setState(state) {
  card.classList.remove('connected', 'disconnected', 'connecting');
  card.classList.add(state);
  dot.classList.remove('connected', 'disconnected', 'connecting');
  dot.classList.add(state);
}

async function refresh() {
  const resp = await send({ type: 'getStatus' });

  if (resp && typeof resp.extensionVersion === 'string') {
    extVersion.textContent = `v${resp.extensionVersion}`;
  }
  if (resp && typeof resp.bridgeUrl === 'string') {
    bridgeUrl.value = resp.bridgeUrl;
  }
  if (resp && resp.tokenConfigured) {
    bridgeToken.placeholder = 'Saved token';
  }

  if (!resp) {
    setState('disconnected');
    statusText.textContent = 'Service worker unavailable';
    daemonVersion.textContent = '';
    profileRow.style.display = 'none';
    return;
  }

  if (typeof resp.contextId === 'string' && resp.contextId.length > 0) {
    contextId.textContent = resp.contextId;
    profileRow.style.display = 'flex';
  } else {
    profileRow.style.display = 'none';
  }

  if (resp.connected) {
    setState('connected');
    statusText.textContent = 'Connected to WebUI';
    daemonVersion.textContent = typeof resp.daemonVersion === 'string' ? `daemon v${resp.daemonVersion}` : '';
  } else if (resp.reconnecting) {
    setState('connecting');
    statusText.textContent = 'Reconnecting...';
    daemonVersion.textContent = '';
  } else {
    setState('disconnected');
    statusText.textContent = 'Not connected';
    daemonVersion.textContent = '';
  }
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(contextId.textContent).then(() => {
    const original = copyBtn.textContent;
    copyBtn.textContent = 'Copied';
    setTimeout(() => { copyBtn.textContent = original; }, 1200);
  });
});

saveBtn.addEventListener('click', async () => {
  saveBtn.textContent = 'Saving...';
  await send({
    type: 'saveSettings',
    baseUrl: bridgeUrl.value,
    token: bridgeToken.value,
  });
  bridgeToken.value = '';
  bridgeToken.placeholder = 'Saved token';
  saveBtn.textContent = 'Save';
  setTimeout(refresh, 350);
});

reconnectBtn.addEventListener('click', async () => {
  reconnectBtn.textContent = 'Connecting...';
  await send({ type: 'reconnect' });
  reconnectBtn.textContent = 'Reconnect';
  setTimeout(refresh, 350);
});

refresh();
