// frontend/js/game.js

const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
const username = sessionStorage.getItem('mafia_username');

if (!roomCode || !username) { 
    window.location.href = "index.html"; 
}
document.getElementById('displayRoomCode').innerText = roomCode;

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const RENDER_BACKEND_DOMAIN = "mafia-api-srab.onrender.com"; 
const WS_BASE_URL = isLocal ? "ws://localhost:8000/ws" : `wss://${RENDER_BACKEND_DOMAIN}/ws`;

let ws;
let myRole = "시민"; 
let isNight = false;
let currentPhase = "LOBBY";
let currentDefenseTarget = null;
let userListCache = [];
let phaseTimer = null;

let localStream;
let peerConnections = {}; 
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function connectWebSocket() {
    ws = new WebSocket(`${WS_BASE_URL}/${roomCode}/${username}`);
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        await handleServerMessage(data);
    };
    ws.onclose = () => {
        appendMessage("시스템", "서버와의 연결이 끊어졌습니다.", "msg-system");
    };
}

function startClientTimer(duration, phaseName) {
    clearInterval(phaseTimer);
    let timeLeft = duration;
    const phaseDisplay = document.getElementById('phaseDisplay');
    
    phaseDisplay.innerHTML = `${phaseName} <span style="color: #f1c40f;">(${timeLeft}초 남음)</span>`;
    
    phaseTimer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(phaseTimer);
            phaseDisplay.innerHTML = `${phaseName} <span style="color: #e74c3c;">(시간 종료)</span>`;
        } else {
            phaseDisplay.innerHTML = `${phaseName} <span style="color: #f1c40f;">(${timeLeft}초 남음)</span>`;
        }
    }, 1000);
}

async function handleServerMessage(data) {
    switch(data.type) {
        case "SYSTEM":
            appendMessage("시스템", data.message, "msg-system");
            break;
            
        case "CHAT":
            appendMessage(data.sender, data.message, "msg-normal");
            break;
            
        case "MAFIA_CHAT":
            appendMessage(`🩸마피아(${data.sender})`, data.message, "msg-mafia");
            break;
            
        case "ROLE_ASSIGN":
            myRole = data.role;
            const roleInfo = document.getElementById('roleInfo');
            roleInfo.innerText = data.message;
            roleInfo.style.display = 'block';
            await initAudioConnection();
            break;
            
        case "USER_LIST":
            userListCache = data.users;
            renderUserList();
            
            const myInfo = data.users.find(u => u.userId === username);
            if (myInfo && myInfo.isHost) {
                document.getElementById('hostBadge').style.display = 'inline-block';
                if (currentPhase === "LOBBY") document.getElementById('hostControls').style.display = 'block';
                else document.getElementById('hostControls').style.display = 'none';
            } else {
                document.getElementById('hostBadge').style.display = 'none';
                document.getElementById('hostControls').style.display = 'none';
            }
            
            await syncPeerConnections(data.users);
            break;
            
        case "PHASE_CHANGE":
            currentPhase = data.phase;
            isNight = (data.phase === "NIGHT");
            let target = data.target;
            
            if (isNight) {
                document.body.className = "night";
                document.getElementById('chatInput').placeholder = myRole === "마피아" ? "마피아 전용 채팅 모드..." : "시민은 밤에 채팅할 수 없습니다.";
                toggleAudioTracks(false); 
                startClientTimer(data.duration, "🌙 밤 (NIGHT)");
            } else if (data.phase === "DAY") {
                document.body.className = "day";
                document.getElementById('chatInput').placeholder = "메시지를 입력하세요...";
                toggleAudioTracks(true);  
                startClientTimer(data.duration, `☀️ ${data.day}일차 낮 (토론)`);
            } else if (data.phase === "VOTE") {
                document.body.className = "day";
                document.getElementById('chatInput').placeholder = "투표 중에는 채팅이 가능합니다...";
                startClientTimer(data.duration, "🗳️ 투표 진행 중");
            } else if (data.phase === "DEFENSE") {
                document.body.className = "day";
                startClientTimer(data.duration, `⚖️ 최후 변론: ${target}`);
            } else if (data.phase === "FINAL_VOTE") {
                document.body.className = "day";
                currentDefenseTarget = target;
                startClientTimer(data.duration, `🗳️ 찬반 투표: ${target} 처형`);
            }
            
            if (currentPhase !== "LOBBY") document.getElementById('hostControls').style.display = 'none';
            
            appendMessage("시스템", data.message, "msg-system");
            renderUserList(); 
            break;

        case "RTC_OFFER":
            await handleRtcOffer(data.sender, data.payload);
            break;
            
        case "RTC_ANSWER":
            if (peerConnections[data.sender]) {
                await peerConnections[data.sender].setRemoteDescription(new RTCSessionDescription(data.payload));
            }
            break;
            
        case "RTC_ICE":
            if (peerConnections[data.sender]) {
                await peerConnections[data.sender].addIceCandidate(new RTCIceCandidate(data.payload));
            }
            break;
            
        case "USER_SPEAKING":
            const userEl = document.getElementById(`user-${data.userId}`);
            if (userEl) {
                if (data.isSpeaking) userEl.classList.add('speaking');
                else userEl.classList.remove('speaking');
            }
            break;
    }
}

function renderUserList() {
    const container = document.getElementById('userList');
    container.innerHTML = "";
    
    userListCache.forEach(user => {
        const div = document.createElement('div');
        div.id = `user-${user.userId}`;
        div.className = `user-item ${user.isAlive ? '' : 'dead'}`;
        
        let nameText = user.userId;
        if (user.userId === username) nameText += " <span style='color: #2ecc71;'>(나)</span>";
        if (user.isHost) nameText += " 👑";
        div.innerHTML = `<span>${nameText}</span>`;
        
        if (user.isAlive && user.userId !== username) {
            if (currentPhase === "VOTE") {
                const btn = document.createElement('button');
                btn.className = "action-btn";
                btn.innerText = "지목";
                btn.onclick = () => sendAction("VOTE", user.userId);
                div.appendChild(btn);
            } else if (currentPhase === "FINAL_VOTE" && user.userId === currentDefenseTarget) {
                const btnYes = document.createElement('button');
                btnYes.className = "action-btn"; btnYes.style.backgroundColor = "#c0392b"; btnYes.style.marginRight = "5px"; btnYes.innerText = "사형(찬성)";
                btnYes.onclick = () => sendAction("FINAL_VOTE", null, "YES");
                
                const btnNo = document.createElement('button');
                btnNo.className = "action-btn"; btnNo.style.backgroundColor = "#27ae60"; btnNo.innerText = "무죄(반대)";
                btnNo.onclick = () => sendAction("FINAL_VOTE", null, "NO");
                
                const wrapper = document.createElement('div');
                wrapper.appendChild(btnYes); wrapper.appendChild(btnNo);
                div.appendChild(wrapper);
            } else if (currentPhase === "NIGHT") {
                const btn = document.createElement('button');
                btn.className = "action-btn";
                if (myRole === "마피아") {
                    btn.innerText = "처형"; btn.onclick = () => sendAction("NIGHT_ACTION", user.userId, "KILL"); div.appendChild(btn);
                } else if (myRole === "의사") {
                    btn.innerText = "치료"; btn.onclick = () => sendAction("NIGHT_ACTION", user.userId, "HEAL"); div.appendChild(btn);
                } else if (myRole === "경찰") {
                    btn.innerText = "조사"; btn.onclick = () => sendAction("NIGHT_ACTION", user.userId, "INVESTIGATE"); div.appendChild(btn);
                }
            }
        }
        container.appendChild(div);
    });
}

function sendAction(actionType, targetId, subAction = null) {
    ws.send(JSON.stringify({
        action: actionType,
        target: targetId,
        subAction: subAction
    }));
}

async function initAudioConnection() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        startVoiceActivityDetection(localStream);
    } catch (e) {
        console.error("마이크 디바이스 접근 획득 실패:", e);
    }
}

function startVoiceActivityDetection(stream) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    let isSpeaking = false;
    
    setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) { sum += dataArray[i]; }
        let average = sum / bufferLength;
        
        let speakingState = average > 15; 
        if (speakingState !== isSpeaking) {
            isSpeaking = speakingState;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: "VOICE_STATUS", isSpeaking: isSpeaking }));
            }
        }
    }, 250);
}

async function syncPeerConnections(users) {
    if (!localStream) return;
    users.forEach(async (user) => {
        if (user.userId !== username && !peerConnections[user.userId] && user.isAlive) {
            const pc = new RTCPeerConnection(rtcConfig);
            peerConnections[user.userId] = pc;
            
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
            
            pc.onicecandidate = (e) => {
                if (e.candidate) ws.send(JSON.stringify({ action: "RTC_ICE", target: user.userId, payload: e.candidate }));
            };
            
            pc.ontrack = (e) => {
                let audioEl = document.getElementById(`audio-${user.userId}`);
                if (!audioEl) {
                    audioEl = document.createElement('audio');
                    audioEl.id = `audio-${user.userId}`;
                    audioEl.autoplay = true;
                    document.getElementById('remoteAudios').appendChild(audioEl);
                }
                audioEl.srcObject = e.streams[0];
                // 브라우저 정책 우회: 오디오 트랙을 활성화하여 강제 재생 시도
                audioEl.play().catch(err => console.log("Audio play blocked by browser:", err));
            };

            if (username > user.userId) { 
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({ action: "RTC_OFFER", target: user.userId, payload: offer }));
            }
        }
    });
}

// [수정] 오디오 송출 불가 버그 해결: 늦게 들어온 유저의 연결 객체(pc)를 완벽히 초기화하고 트랙을 바인딩합니다.
async function handleRtcOffer(sender, offer) {
    let pc = peerConnections[sender];
    if (!pc) {
        pc = new RTCPeerConnection(rtcConfig);
        peerConnections[sender] = pc;
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        pc.onicecandidate = (e) => {
            if (e.candidate) ws.send(JSON.stringify({ action: "RTC_ICE", target: sender, payload: e.candidate }));
        };
        pc.ontrack = (e) => {
            let audioEl = document.getElementById(`audio-${sender}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${sender}`;
                audioEl.autoplay = true;
                document.getElementById('remoteAudios').appendChild(audioEl);
            }
            audioEl.srcObject = e.streams[0];
            audioEl.play().catch(err => console.log("Audio play error:", err));
        };
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ action: "RTC_ANSWER", target: sender, payload: answer }));
}

function toggleAudioTracks(enable) {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = enable);
    }
    const remoteAudios = document.getElementById('remoteAudios').querySelectorAll('audio');
    remoteAudios.forEach(audio => { audio.muted = !enable; });
}

function appendMessage(sender, message, className) {
    const chatBox = document.getElementById('chatBox');
    const msgDiv = document.createElement('div');
    msgDiv.className = className;
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${message}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    if (isNight && myRole !== "마피아") { 
        alert("시민은 밤에 침묵해야 합니다."); 
        input.value = "";
        return; 
    }
    ws.send(JSON.stringify({ action: "CHAT", message: text }));
    input.value = "";
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') sendMessage(); 
});

document.getElementById('startBtn').addEventListener('click', () => {
    const dayTimeInput = document.getElementById('dayTimeInput');
    const nightTimeInput = document.getElementById('nightTimeInput');
    
    const dayTime = dayTimeInput ? parseInt(dayTimeInput.value) || 30 : 30;
    const nightTime = nightTimeInput ? parseInt(nightTimeInput.value) || 20 : 20;

    ws.send(JSON.stringify({ 
        action: "START_GAME",
        settings: {
            day_time: dayTime,
            night_time: nightTime
        }
    }));
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => { 
    if(confirm("퇴장하시겠습니까?")) { 
        if(ws) ws.close(); 
        sessionStorage.removeItem('mafia_username');
        window.location.href="index.html"; 
    } 
});

window.onload = connectWebSocket;