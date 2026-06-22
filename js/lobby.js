// frontend/js/lobby.js

// 환경 자동 감지 및 API 주소 설정
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// 👉 배포 후 아래 빈칸에 Render에서 발급받은 백엔드 도메인을 적어주세요. (예: my-mafia-api.onrender.com)
const RENDER_BACKEND_DOMAIN = "https://mafia-api-srab.onrender.com"; 

const BACKEND_URL = isLocal 
    ? "http://localhost:8000" 
    : `https://${RENDER_BACKEND_DOMAIN}`;

// 방 생성 버튼 이벤트
document.getElementById('createRoomBtn').addEventListener('click', async () => {
    try {
        const response = await fetch(`${BACKEND_URL}/api/create-room`);
        const data = await response.json();
        
        const roomCode = data.room_code;
        
        document.getElementById('newRoomCodeDisplay').style.display = 'block';
        document.getElementById('newRoomCode').innerText = roomCode;
        document.getElementById('roomCodeInput').value = roomCode;
        
    } catch (error) {
        console.error("방 생성 오류:", error);
        alert("방 생성에 실패했습니다. 서버 상태를 확인해주세요.");
    }
});

// 방 입장 버튼 이벤트
document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    const username = document.getElementById('usernameInput').value.trim();

    if (!roomCode || roomCode.length !== 6) {
        alert("올바른 6자리 방 코드를 입력해주세요.");
        return;
    }
    if (!username) {
        alert("닉네임을 입력해주세요.");
        return;
    }

    localStorage.setItem('mafia_username', username);
    window.location.href = `game.html?room=${roomCode}`;
});