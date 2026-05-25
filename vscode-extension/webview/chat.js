// @ts-nocheck
const vscode = acquireVsCodeApi()

// State
let wsPort = null
let ws = null
let reconnectAttempts = 0
let currentAssistantBubble = null
let currentAssistantText = ''
let context = { currentFile: null, selectedCode: null, workspaceStructure: null }

// DOM refs
const messagesEl = document.getElementById('messages')
const inputEl = document.getElementById('input')
const sendBtn = document.getElementById('send-btn')
const chipsEl = document.getElementById('context-chips')
const statusEl = document.getElementById('status-bar')

// ── VSCode → Webview messages ──────────────────────────────────────────────
window.addEventListener('message', (event) => {
  const msg = event.data
  if (msg.type === 'init') {
    wsPort = msg.port
    loadHistory(msg.history || [])
    connectWs()
  } else if (msg.type === 'context_update') {
    updateContextChips(msg.context)
  } else {
    handleServerMessage(msg)
  }
})

// Signal ready to extension
vscode.postMessage({ type: 'ready' })

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWs() {
  setStatus('Connecting...')
  ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)

  ws.onopen = () => {
    reconnectAttempts = 0
    setStatus('')
  }

  ws.onmessage = (e) => {
    try { handleServerMessage(JSON.parse(e.data)) } catch {}
  }

  ws.onclose = () => {
    if (reconnectAttempts < 5) {
      const delay = Math.pow(2, reconnectAttempts) * 1000
      reconnectAttempts++
      setStatus(`Reconnecting in ${delay / 1000}s...`)
      setTimeout(connectWs, delay)
    } else {
      setStatus('Disconnected. <a href="#" id="reconnect-link">Reconnect</a>')
      document.getElementById('reconnect-link')?.addEventListener('click', (e) => {
        e.preventDefault()
        reconnectAttempts = 0
        connectWs()
      })
    }
  }

  ws.onerror = () => setStatus('Connection error')
}

function sendToServer(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

// ── Server message handler ─────────────────────────────────────────────────
function handleServerMessage(msg) {
  if (msg.type === 'stream_delta') {
    if (!currentAssistantBubble) {
      currentAssistantText = ''
      currentAssistantBubble = appendAssistantBubble()
    }
    currentAssistantText += msg.content
    renderAssistantText(currentAssistantBubble, currentAssistantText)
    scrollToBottom()
  } else if (msg.type === 'stream_end') {
    currentAssistantBubble = null
    currentAssistantText = ''
    setSending(false)
  } else if (msg.type === 'tool_call') {
    if (!currentAssistantBubble) {
      currentAssistantBubble = appendAssistantBubble()
    }
    appendToolCall(currentAssistantBubble, msg)
  } else if (msg.type === 'tool_result') {
    updateToolResult(msg.id, msg.result)
  } else if (msg.type === 'error') {
    appendError(msg.message)
    setSending(false)
  }
}

// ── Send message ───────────────────────────────────────────────────────────
function sendMessage() {
  const content = inputEl.value.trim()
  if (!content || !ws || ws.readyState !== WebSocket.OPEN) return

  appendUserMessage(content)
  inputEl.value = ''
  setSending(true)

  sendToServer({ type: 'message', content, context: buildContext() })
}

function buildContext() {
  return {
    currentFile: context.currentFile,
    selectedCode: context.selectedCode,
    workspaceStructure: context.workspaceStructure,
  }
}

// ── DOM helpers ────────────────────────────────────────────────────────────
function appendUserMessage(text) {
  const div = document.createElement('div')
  div.className = 'message user'
  div.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`
  messagesEl.appendChild(div)
  scrollToBottom()
}

function appendAssistantBubble() {
  const div = document.createElement('div')
  div.className = 'message assistant'
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  div.appendChild(bubble)
  messagesEl.appendChild(div)
  scrollToBottom()
  return bubble
}

function renderAssistantText(bubble, text) {
  // @ts-ignore
  const html = marked.parse(text)
  bubble.innerHTML = html
  bubble.querySelectorAll('pre').forEach(pre => {
    if (!pre.querySelector('.copy-btn')) {
      const btn = document.createElement('button')
      btn.className = 'copy-btn'
      btn.textContent = 'Copy'
      btn.onclick = () => {
        navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? pre.textContent ?? '')
        btn.textContent = 'Copied!'
        setTimeout(() => { btn.textContent = 'Copy' }, 1500)
      }
      pre.style.position = 'relative'
      pre.appendChild(btn)
    }
  })
  // @ts-ignore
  bubble.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el))
}

function appendToolCall(bubble, msg) {
  const details = document.createElement('details')
  details.className = 'tool-block'
  details.dataset.toolId = msg.id
  details.open = true
  details.innerHTML = `
    <summary>🔧 ${escapeHtml(msg.name)}</summary>
    <pre>${escapeHtml(JSON.stringify(msg.params, null, 2))}</pre>
  `

  const autoApprove = (window.__autoApproveTools || []).includes(msg.name)
  if (!autoApprove) {
    const approvalDiv = document.createElement('div')
    approvalDiv.className = 'tool-approval'
    approvalDiv.innerHTML = `
      <button class="approve-btn" data-id="${msg.id}">Allow</button>
      <button class="deny-btn" data-id="${msg.id}">Deny</button>
    `
    approvalDiv.querySelector('.approve-btn').onclick = () => {
      sendToServer({ type: 'tool_approval', id: msg.id, approved: true })
      approvalDiv.remove()
    }
    approvalDiv.querySelector('.deny-btn').onclick = () => {
      sendToServer({ type: 'tool_approval', id: msg.id, approved: false })
      approvalDiv.remove()
    }
    details.appendChild(approvalDiv)
  } else {
    sendToServer({ type: 'tool_approval', id: msg.id, approved: true })
  }

  bubble.appendChild(details)
  scrollToBottom()
}

function updateToolResult(id, result) {
  const details = messagesEl.querySelector(`[data-tool-id="${id}"]`)
  if (details) {
    const resultPre = document.createElement('pre')
    resultPre.textContent = result.length > 500 ? result.slice(0, 500) + '…' : result
    details.appendChild(resultPre)
    details.open = false
  }
}

function appendError(message) {
  const div = document.createElement('div')
  div.className = 'error-msg'
  div.textContent = '⚠ ' + message
  messagesEl.appendChild(div)
  scrollToBottom()
}

function updateContextChips(ctx) {
  context = ctx
  chipsEl.innerHTML = ''
  if (ctx.currentFile) addChip('📄 ' + ctx.currentFile.path.split('/').pop(), () => { context.currentFile = null; updateContextChips(context) })
  if (ctx.selectedCode) addChip(`✂ Lines ${ctx.selectedCode.startLine}-${ctx.selectedCode.endLine}`, () => { context.selectedCode = null; updateContextChips(context) })
  if (ctx.workspaceStructure) addChip('🗂 Workspace', () => { context.workspaceStructure = null; updateContextChips(context) })
}

function addChip(label, onRemove) {
  const chip = document.createElement('div')
  chip.className = 'chip'
  chip.innerHTML = `<span>${escapeHtml(label)}</span><button title="Remove">×</button>`
  chip.querySelector('button').onclick = onRemove
  chipsEl.appendChild(chip)
}

function loadHistory(history) {
  for (const msg of history) {
    if (msg.role === 'user') appendUserMessage(msg.content)
    else if (msg.role === 'assistant') {
      const bubble = appendAssistantBubble()
      renderAssistantText(bubble, msg.content)
    }
  }
}

function setSending(sending) {
  sendBtn.disabled = sending
  inputEl.disabled = sending
  setStatus(sending ? 'Claude is thinking…' : '')
}

function setStatus(text) {
  statusEl.innerHTML = text
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Input events ───────────────────────────────────────────────────────────
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})
sendBtn.addEventListener('click', sendMessage)
