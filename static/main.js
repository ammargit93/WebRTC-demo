const socket = io('https://aa94-45-115-187-71.ngrok-free.app', {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 60000
});

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const generateCodeButton = document.getElementById('generateCodeButton');
const joinCodeButton = document.getElementById('joinCodeButton');
const codeInput = document.getElementById('codeInput');
const statusDiv = document.getElementById('status');

let localStream;
let peerConnection = null;
let code;
let pendingCandidates = [];

// Connection monitoring
socket.on('connect', () => {
    console.log('✅ Connected to server with ID:', socket.id);
    updateStatus('Connected to server');
});

socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error);
    updateStatus('Connection error! Please check your internet connection.', 'error');
});

socket.on('disconnect', () => {
    console.log('🔌 Disconnected from server');
    updateStatus('Disconnected from server', 'error');
});

// Generate a code
generateCodeButton.onclick = () => {
    console.log("Requesting new code from server...");
    updateStatus('Generating code...');
    socket.emit('generate_code');
};

// Join a code
joinCodeButton.onclick = () => {
    const codeToJoin = codeInput.value.trim();
    if (codeToJoin) {
        console.log("Attempting to join with code:", codeToJoin);
        updateStatus('Joining code...');
        socket.emit('join_code', { code: codeToJoin });
    } else {
        console.warn("⚠️ No code entered!");
        updateStatus('Please enter a code first', 'error');
    }
};

// Handle code generation
socket.on('code_generated', (data) => {
    code = data.code;
    console.log("Received new code from server:", code);
    updateStatus(`Your code is: ${code}`);
    alert(`Your code is: ${code}. Share it with your friend!`);
});

// Handle code joining
socket.on('code_accepted', async (data) => {
    console.log("✅ Code accepted by server! Starting WebRTC...");
    updateStatus('Code accepted! Starting connection...');
    await startWebRTC(data.peer_sid, true);
});

socket.on('peer_joined', async (data) => {
    console.log("👥 Peer joined with ID:", data.peer_sid);
    updateStatus('Peer joined! Starting connection...');
    await startWebRTC(data.peer_sid, false);
});

// Handle WebRTC signaling
socket.on('signal', async (data) => {
    if (!peerConnection) {
        console.warn("⚠️ Received signal but no peerConnection exists!");
        return;
    }
    
    console.log('🔄 Received Signal:', data);

    try {
        if (data.description) {
            const remoteDesc = new RTCSessionDescription(data.description);
            console.log("📄 Received SDP:", data.description.type);

            if (data.description.type === 'offer') {
                await peerConnection.setRemoteDescription(remoteDesc);
                console.log("✅ Remote Description Set (Offer)");
                
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('signal', { target_sid: data.sender_sid, description: answer });

            } else if (data.description.type === 'answer') {
                if (peerConnection.signalingState !== 'stable') {
                    await peerConnection.setRemoteDescription(remoteDesc);
                    console.log("✅ Remote Description Set (Answer)");
                } else {
                    console.warn("⚠️ Ignoring duplicate answer SDP");
                }
            }
            
            // After setting remote description, add any pending candidates
            while (pendingCandidates.length) {
                const candidate = pendingCandidates.shift();
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log("✅ Added pending ICE candidate");
            }
        } 
        
        else if (data.candidate) {
            console.log("❄️ Received ICE Candidate:", data.candidate);

            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                console.log("✅ ICE Candidate Added");
            } else {
                console.warn("🚧 ICE candidate received before remote description, storing...");
                pendingCandidates.push(data.candidate);
            }
        }
    } catch (error) {
        console.error('❌ Error handling signaling data:', error);
        updateStatus('Connection error occurred', 'error');
    }
});

socket.on('error_message', (data) => {
    console.error("Server error:", data.message);
    updateStatus(data.message, 'error');
    alert(data.message);
});

async function startWebRTC(target_sid, isInitiator) {
    try {
        // First check if we have media permissions
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            console.log('✅ Got media permissions');
            updateStatus('Camera and microphone accessed');
        } catch (mediaError) {
            console.error('❌ Media permission error:', mediaError);
            updateStatus('Please allow camera and microphone access', 'error');
            alert('Please allow camera and microphone access to use this app.');
            return;
        }

        if (!peerConnection) {
            peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }, // STUN server
                    { 
                        urls: 'turn:turn.bistri.com:80', // TURN server
                        username: 'homeo', // Username
                        credential: 'homeo' // Password
                    }
                ]
            });

            // Connection state monitoring
            peerConnection.onconnectionstatechange = () => {
                console.log('💫 Connection State:', peerConnection.connectionState);
                updateStatus(`Connection state: ${peerConnection.connectionState}`);
                if (peerConnection.connectionState === 'failed') {
                    updateStatus('Connection failed. Please try again.', 'error');
                }
            };

            peerConnection.onsignalingstatechange = () => {
                console.log('🤝 Signaling State:', peerConnection.signalingState);
            };

            // Set up event handlers
            peerConnection.ontrack = (event) => {
                console.log("📡 Received remote track");
                if (remoteVideo.srcObject !== event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                    updateStatus('Connected to peer');
                }
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log("📤 Sending ICE candidate");
                    socket.emit('signal', {
                        target_sid: target_sid,
                        candidate: event.candidate
                    });
                }
            };

            peerConnection.oniceconnectionstatechange = () => {
                console.log("🌐 ICE Connection State:", peerConnection.iceConnectionState);
                updateStatus(`ICE state: ${peerConnection.iceConnectionState}`);
            };
        }

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        if (isInitiator) {
            console.log("📤 Creating and sending offer");
            updateStatus('Creating connection offer...');
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { target_sid, description: offer });
        }
    } catch (error) {
        console.error('❌ Error starting WebRTC:', error);
        updateStatus('Failed to start video call', 'error');
    }
}

function updateStatus(message, type = 'info') {
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
    }
}

// Cleanup function
function cleanup() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }
    if (localVideo.srcObject) {
        localVideo.srcObject = null;
    }
}

// Add cleanup on window unload
window.onbeforeunload = cleanup;