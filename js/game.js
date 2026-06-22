// frontend/js/game.js

// URL 파라미터 및 스토리지 데이터 가져오기
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
const username = localStorage.getItem('mafia_username');

if (!roomCode || !username) {
    alert("비정상적인 접근입니다. 로비로 돌아갑니다.");
    window.location.href = "index.html";
}

document.getElementById('displayRoomCode').innerText = roomCode;

// 환경 자동 감지 및 웹소켓 주소 설정
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const RENDER_BACKEND_DOMAIN = "mafia-api-srab.onrender.com"; // lobby.js와 동일하게 작성

// 로컬은 ws://, Render 배포 환경은 wss:// (보안 웹소켓) 사용
const WS_BASE_URL = isLocal 
    ? "ws://localhost:8000/ws" 
    : `wss://${RENDER_BACKEND_DOMAIN}/ws`;

const WS_URL = `${WS_BASE_URL}/${roomCode}/${username}`;

let ws;
let myRole = "CITIZEN"; 
let isNight = false;

function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };

    ws.onclose = () => {
        appendMessage("시스템", "서버와의 연결이 끊어졌습니다.", "msg-system");
    };
}

function handleServerMessage(data) {
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
            
            if(data.message.includes("방장")) {
                document.getElementById('hostControls').style.display = 'block';
            }
            break;
            
        case "PHASE_CHANGE":
            const phaseDisplay = document.getElementById('phaseDisplay');
            if (data.phase === "NIGHT") {
                isNight = true;
                phaseDisplay.innerText = "🌙 밤 (NIGHT)";
                document.body.className = "night";
                document.getElementById('chatInput').placeholder = myRole === "MAFIA" ? "마피아 전용 채팅 모드..." : "시민은 밤에 채팅할 수 없습니다.";
                
                controlAudio(false);
                appendMessage("시스템", data.message, "msg-system");
                
            } else if (data.phase === "DAY") {
                isNight = false;
                phaseDisplay.innerText = `☀️ ${data.day}일차 낮`;
                document.body.className = "day";
                document.getElementById('chatInput').placeholder = "메시지를 입력하세요...";
                
                controlAudio(true);
                appendMessage("시스템", data.message, "msg-system");
            }
            break;
    }
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

    if (isNight && myRole !== "MAFIA") {
        alert("시민은 밤에 채팅할 수 없습니다!");
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

function controlAudio(enable) {
    if (enable) {
        console.log("WebRTC 마이크 및 헤드셋 활성화 (낮)");
    } else {
        console.log("WebRTC 마이크 및 헤드셋 차단 (밤)");
    }
}

// 방장 컨트롤 버튼 이벤트
document.getElementById('startBtn').addEventListener('click', () => {
    ws.send(JSON.stringify({ action: "START_GAME" }));
});
document.getElementById('testNightBtn').addEventListener('click', () => {
    ws.send(JSON.stringify({ action: "TEST_NIGHT_TOGGLE" }));
});
document.getElementById('testDayBtn').addEventListener('click', () => {
    ws.send(JSON.stringify({ action: "TEST_DAY_TOGGLE" }));
});

// 테스트용: 화면 로드 직후 방장 메뉴 활성화
document.getElementById('hostControls').style.display = 'block';

// 페이지 로드 시 웹소켓 연결 시작
window.onload = connectWebSocket;