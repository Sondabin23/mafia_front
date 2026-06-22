// frontend/js/game.js
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
const username = localStorage.getItem('mafia_username');

if (!roomCode || !username) { window.location.href = "index.html"; }
document.getElementById('displayRoomCode').innerText = roomCode;

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const RENDER_BACKEND_DOMAIN = "mafia-api-srab.onrender.com"; 
const WS_BASE_URL = isLocal ? "ws://localhost:8000/ws" : `wss://${RENDER_BACKEND_DOMAIN}/ws`;

let ws;
let myRole = "시민"; 
let isNight = false;
let currentPhase = "LOBBY";
let userListCache = [];

// WebRTC 관련 상태 전역 관리
let localStream;
let peerConnections = {}; // {userId: RTCPeerConnection}
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function connectWebSocket() {
    ws = new WebSocket(`${WS_BASE_URL}/${roomCode}/${username}`);
    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        await handleServerMessage(data);
    };
}

// frontend/js/game.js 의 handleServerMessage 함수를 이 코드로 덮어쓰기 하세요.

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
            break;
            
        case "USER_LIST":
            userListCache = data.users;
            renderUserList();
            
            // ✨ [수정] 유저 목록이 갱신될 때마다 내가 방장인지 체크하여 로비 단계에서 메뉴 노출
            const myInfo = data.users.find(u => u.userId === username);
            if (myInfo && myInfo.isHost) {
                document.getElementById('hostBadge').style.display = 'inline-block';
                
                // 게임 시작 전(LOBBY)에만 게임 시작 버튼 패널을 보여줍니다.
                if (currentPhase === "LOBBY") {
                    document.getElementById('hostControls').style.display = 'block';
                } else {
                    document.getElementById('hostControls').style.display = 'none';
                }
            } else {
                document.getElementById('hostBadge').style.display = 'none';
                document.getElementById('hostControls').style.display = 'none';
            }
            
            await syncPeerConnections(data.users);
            break;
            
        case "PHASE_CHANGE":
            currentPhase = data.phase;
            const phaseDisplay = document.getElementById('phaseDisplay');
            isNight = (data.phase === "NIGHT");
            
            // ✨ [수정] 낮/밤 페이즈가 변했을 때도 게임이 진행 중이면 방장 메뉴(시작 버튼)를 자동으로 숨김
            const hostCheck = userListCache.find(u => u.userId === username);
            if (hostCheck && hostCheck.isHost && currentPhase === "LOBBY") {
                document.getElementById('hostControls').style.display = 'block';
            } else {
                document.getElementById('hostControls').style.display = 'none';
            }
            
            if (isNight) {
                phaseDisplay.innerText = "🌙 밤 (NIGHT)";
                document.body.className = "night";
                toggleAudioTracks(false); // 밤에는 전원 마이크/헤드셋 차단
                appendMessage("시스템", data.message, "msg-system");
                
            } else {
                phaseDisplay.innerText = data.phase === "VOTE" ? "🗳️ 투표 진행 중" : `☀️ ${data.day}일차 낮`;
                document.body.className = "day";
                toggleAudioTracks(true);  // 낮에는 다시 소통 허용
                appendMessage("situ", data.message, "msg-system");
            }
            renderUserList(); 
            break;

        case "RTC_OFFER":
            await handleRtcOffer(data.sender, data.payload);
            break;
        case "RTC_ANSWER":
            await peerConnections[data.sender].setRemoteDescription(new RTCSessionDescription(data.payload));
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

// 2&4번 조항: 사이드바 유저 인터페이스 구성 및 투표/스킬 매핑 기능
function renderUserList() {
    const container = document.getElementById('userList');
    container.innerHTML = "";
    
    userListCache.forEach(user => {
        const div = document.createElement('div');
        div.id = `user-${user.userId}`;
        div.className = `user-item ${user.isAlive ? '' : 'dead'}`;
        
        let nameText = user.userId;
        if (user.isHost) nameText += " (방장)";
        div.innerHTML = `<span>${nameText}</span>`;
        
        // 내 자신에겐 투표나 타겟팅을 하지 못하도록 설계 보완
        if (user.isAlive && user.userId !== username) {
            if (currentPhase === "VOTE") {
                const btn = document.createElement('button');
                btn.className = "action-btn";
                btn.innerText = "투표";
                btn.onclick = () => sendAction("VOTE", user.userId);
                div.appendChild(btn);
            } else if (currentPhase === "NIGHT") {
                const btn = document.createElement('button');
                btn.className = "action-btn";
                
                if (myRole === "마피아") {
                    btn.innerText = "처형";
                    btn.onclick = () => sendAction("NIGHT_ACTION", user.userId, "KILL");
                    div.appendChild(btn);
                } else if (myRole === "의사") {
                    btn.innerText = "치료";
                    btn.onclick = () => sendAction("NIGHT_ACTION", user.userId, "HEAL");
                    div.appendChild(btn);
                } else if (myRole === "경찰") {
                    btn.innerText = "조사";
                    btn.onclick = () => sendAction("NIGHT_ACTION", user.userId, "INVESTIGATE");
                    div.appendChild(btn);
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

// 3번 조항: 하드웨어 마이크 입력 장치 스트림 공유 가로채기 함수
async function initAudioConnection() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        startVoiceActivityDetection(localStream);
    } catch (e) {
        console.error("마이크 디바이스 접근 획득 실패:", e);
    }
}

// 3번 조항: 실시간 말하기 유저 이펙트용 볼륨 레벨 게이지 트래킹 연산 로직
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
        
        // 일정 음량 이상 말하는 상태 검증 스레스홀드 매핑
        let speakingState = average > 15; 
        if (speakingState !== isSpeaking) {
            isSpeaking = speakingState;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: "VOICE_STATUS", isSpeaking: isSpeaking }));
            }
        }
    }, 250);
}

// P2P 커넥션 풀 싱크 맞추기 가동 로직
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
            };

            // 방에 나중에 들어온 사람이 기존 방 회원들에게 Offer 발행
            if (username > user.userId) { 
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({ action: "RTC_OFFER", target: user.userId, payload: offer }));
            }
        }
    });
}

async function handleRtcOffer(sender, offer) {
    const pc = peerConnections[sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ action: "RTC_ANSWER", target: sender, payload: answer }));
    }
}

function toggleAudioTracks(enable) {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = enable);
    }
    // 상대방 소리 듣기 권한(헤드셋 차단/복구) 제어
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
    if (isNight && myRole !== "마피아") { alert("시민은 밤에 침묵해야 합니다."); return; }
    ws.send(JSON.stringify({ action: "CHAT", message: text }));
    input.value = "";
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
document.getElementById('startBtn').addEventListener('click', () => { ws.send(JSON.stringify({ action: "START_GAME" })); });
document.getElementById('leaveRoomBtn').addEventListener('click', () => { if(confirm("퇴장하시겠습니까?")) { if(ws)ws.close(); window.location.href="index.html"; } });

window.onload = connectWebSocket;