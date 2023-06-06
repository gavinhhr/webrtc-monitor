'use strict';

// html page widget
var loginBtn = document.querySelector('#loginBtn');
var hangUpBtn = document.querySelector('#hangUpBtn');
var localVideo = document.querySelector('#localVideo');
hangUpBtn.disabled = true;

// signalling server IP address
var serverURL = 'ws://47.115.205.65:9091'
// monitor username in server, can be used as client password
var myUsername = 'monitor';
// client username in server
var connectedUsername = null;
// WebSocket object
var myWebSocket;
// RTCPeerConnection object
var myPeerConnection;
// camera stream
var stream;
// whether RTCPeerConnection has been created
var RTCPeerConnectionCreated = false;

// Set stream Codec
const codecPreferences = document.querySelector('#codecPreferences');
const supportsSetCodecPreferences = window.RTCRtpTransceiver &&
    'setCodecPreferences' in window.RTCRtpTransceiver.prototype;

// setting the STUN/TURN server IP
const configuration = {
    "iceServers":
        [
            {
                'urls': 'stun:47.115.205.65:3478',
            },
            {
                'urls': 'turn:47.115.205.65',
                'username': 'hhr',
                'credential': '123456'
            }
        ]
};

/**
 * botton to start WebSocket connection and open the camera
 */
loginBtn.addEventListener("click", function () {
    // connect to signalling server with WebSocket
    myWebSocket = new WebSocket(serverURL);
    // message handle function
    myWebSocket.onmessage = function (message) {
        // print message in console
        console.log("Got message: ", message.data);
        // handle message
        var data = JSON.parse(message.data);
        console.log(data)
        switch (data.type) {
            case "login":
                handleLogin(data.success);
                break;
            // call from client
            case "offer":
                handleOffer(data.offer, data.name);
                break;
            case "answer":
                handleAnswer(data.answer);
                break;
            // receive ICE candidate
            case "candidate":
                handleCandidate(data.candidate);
                break;
            // client disconnect
            case "leave":
                handleLeave();
                break;
            // client require monitor video
            case "cmd":
                handleCmd(data.sender);
                break;
            // server information
            case "sendinfo":
                alert(data.info);
                if (data.close == true) {
                    window.location.href = "about:blank";
                }
                break;
            default:
                break;
        }
    };
    // error handle function
    myWebSocket.onerror = function (err) {
        console.log("Got error: ", err);
    };
    // connection handle function
    myWebSocket.onopen = function () {
        console.log("Connected to the signalling server.");
        // login to the signalling server
        if (myUsername.length > 0) {
            sendToServer({
                type: "login",
                name: myUsername
            });
        }
        //getting local video stream
        navigator.mediaDevices.getUserMedia({
            video: true, audio: true
        }).then(
            myStream => {
                stream = myStream
                //displaying local video stream on the page
                localVideo.srcObject = stream;
                window.localStream = stream;
            }
        ).catch(
            err => {
                console.log(err);
            }
        );
        if (supportsSetCodecPreferences) {
            const { codecs } = RTCRtpSender.getCapabilities('video');
            console.log('RTCRtpSender.getCapabilities(video):\n', codecs);
            codecs.forEach(codec => {
                if (['video/red', 'video/ulpfec', 'video/rtx'].includes(codec.mimeType)) {
                    return;
                }
                const option = document.createElement('option');
                option.value = (codec.mimeType + ' ' + (codec.sdpFmtpLine || '')).trim();
                option.innerText = option.value;
                codecPreferences.appendChild(option);
            });
            codecPreferences.disabled = false;
        } else {
            console.warn('Your browser do not support changing codec.');
        }
    };
    // enable/disable corresponding button
    loginBtn.disabled = true;
    hangUpBtn.disabled = false;
});

/**
 * botton to disconnect to the client/server
 */
hangUpBtn.addEventListener("click", function () {
    // inform the server we are going to hangup
    sendToServer({
        type: "sendinfo",
        info: "monitor disconnected to server",
        close: false
    });
    // inform client we have hangup
    if (connectedUsername == null) {
        sendToServer({
            type: "leave",
            name: 'undefined'
        });
    } else {
        sendToServer({
            type: "leave",
        });
    }
    // if client has connected, close the RTCPeerConnection, otherwise, just stop getting stream from camera
    if (connectedUsername != null) {
        handleLeave();
    }
    // stop getting local video stream
    stream.getTracks().forEach(track => track.stop());
    localVideo.srcObject = null;
    window.localStream = null;
    // enable/disable corresponding button
    hangUpBtn.disabled = true;
    loginBtn.disabled = false;
});

/**
 * send message to server
 * @param message
 */
function sendToServer(message) {
    // if client connected, send message to client through server
    if (connectedUsername) {
        message.name = connectedUsername;
    }
    myWebSocket.send(JSON.stringify(message));
};

/**
 * initialize the RTCPeerConnection
 * @returns 
 */
function initPeer() {
    // add prefix
    let PeerConnection = window.RTCPeerConnection ||
        window.mozRTCPeerConnection ||
        window.webkitRTCPeerConnection;

    try {
        myPeerConnection = new RTCPeerConnection(configuration);
        // add stream to track
        if ("addTrack" in myPeerConnection) {
            stream.getTracks().forEach(track => {
                myPeerConnection.addTrack(track, stream);
            });
        } else {
            myPeerConnection.addStream(stream);
        }

        if (supportsSetCodecPreferences) {
            // get available codec
            const preferredCodec = codecPreferences.options[codecPreferences.selectedIndex];
            if (preferredCodec.value !== '') {
                const [mimeType, sdpFmtpLine] = preferredCodec.value.split(' ');
                const { codecs } = RTCRtpSender.getCapabilities('video');
                const selectedCodecIndex = codecs.findIndex(c => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine);
                const selectedCodec = codecs[selectedCodecIndex];
                codecs.splice(selectedCodecIndex, 1);
                codecs.unshift(selectedCodec);
                console.log(codecs);
                const transceiver = myPeerConnection.getTransceivers().find(t => t.sender && t.sender.track === localStream.getVideoTracks()[0]);
                transceiver.setCodecPreferences(codecs);
                console.log('Preferred Codec: ', selectedCodec);
            }
        }
        codecPreferences.disabled = true;

        // setup stream listening
        if ("ontrack" in myPeerConnection) {
            // when a remote user adds stream to the peer connection, we display it
            myPeerConnection.ontrack = async function (event) {
                hangUpBtn.disabled = false;
            }

        } else {
            // when a remote user adds stream to the peer connection, we display it
            myPeerConnection.onaddstream = async function (event) {
                hangUpBtn.disabled = false;
            }

        }

        myPeerConnection.oniceconnectionstatechange = async function (event) {
            // handle changes of ICE connection state
            console.log("ICE connection state changed to " + myPeerConnection.iceConnectionState);
            switch (myPeerConnection.iceConnectionState) {
                case "closed":
                case "failed":
                case "disconnected":
                    handleLeave();
                    break;
                case "connected":
                    hangUpBtn.disabled = false;
                    break;
            }
        };
        myPeerConnection.onicegatheringstatechange = async function (event) {
            console.log("ICE gathering state changed to " + myPeerConnection.iceGatheringState);
        }
        myPeerConnection.onsignalingstatechange = async function (event) {
            // setup a |signalingstatechange| event handler. This will detect when the signaling connection is closed.
            if (myPeerConnection == null) {
                return;
            }
            console.log("WebRTC signalling state changed to " + myPeerConnection.signalingState);
            switch (myPeerConnection.signalingState) {
                case "closed":
                    handleLeave();
                    break;
            }
        }
        // RTCPeerConnectionCreated has created
        RTCPeerConnectionCreated = true;
    } catch (err) {
        console.log('Failed to create PeerConnection: ' + err.message);
        alert('Cannot create RTCPeerConnection object.');
        RTCPeerConnectionCreated = false;
        return;
    }

    // display codec actually used
    setTimeout(async () => {
        const stats = await myPeerConnection.getStats();
        stats.forEach(stat => {
            if (!(stat.type === 'outbound-rtp' && stat.kind === 'video')) {
                return;
            }
            const codec = stats.get(stat.codecId);
            console.log('Actually using ' + codec.mimeType +
                ' ' + (codec.sdpFmtpLine ? codec.sdpFmtpLine + ' ' : '') +
                ', payloadType=' + codec.payloadType + '. Encoder: ' + stat.encoderImplementation);
        });
    }, 1000);
}

/**
 * when server sends login reply
 * @param success
 */
function handleLogin(success) {
    // client username is a duplicate of myUsername
    if (success === false) {
        alert("The same username has in server, try another username.");
    }
};

/**
 * when client sends us an offer
 * @param offer offer content
 * @param name  username of whom send offer
 * @returns {Promise<void>}
 */
async function handleOffer(offer, name) {
    // setup a new connection if RTCPeerConnection hasn't been created
    if (RTCPeerConnectionCreated == false) {
        initPeer();
    }

    connectedUsername = name;
    // handle offer
    await myPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    // create answer for the offer
    myPeerConnection.createAnswer().then(function (answer) {

        myPeerConnection.setLocalDescription(answer);
        sendToServer({
            type: "answer",
            answer: answer
        });
    }).catch(function (error) {
        alert("Error when creating an answer.");
    });
};

/**
 * when we get an answer from client
 * @param answer answer from client
 * @returns {Promise<void>}
 */
async function handleAnswer(answer) {
    // handle answer
    await myPeerConnection.setRemoteDescription(new RTCSessionDescription(answer));
};

/**
 * when we get an ICE candidate from STUN/TURN server
 * @param candidate ICE candidate
 */
function handleCandidate(candidate) {
    myPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
};

/**
 * when monitor disconnect
 */
function handleLeave() {

    // clear client username
    connectedUsername = null;
    // disconnect all event listeners
    myPeerConnection.onicecandidate = null;
    myPeerConnection.onaddstream = null;
    myPeerConnection.ontrack = null;
    myPeerConnection.onsignalingstatechange = null;
    myPeerConnection.onicegatheringstatechange = null;
    myPeerConnection.close();
    myPeerConnection = null;
    // RTCPeerConnection not created
    RTCPeerConnectionCreated = false;
    // disable hangup botton on the page
    hangUpBtn.disabled = false;

};

/**
 * when client requires our video stream
 * @param {*} sender username of client
 * @returns 
 */
function handleCmd(sender) {
    // create Offer and setLocalDescription
    if (sender.length > 0) {
        // username of our stream's receiver
        connectedUsername = sender;
        // inform client that monitor is not opened
        if (stream == null || !stream.active) {
            sendToServer({
                type: "sendinfo",
                info: "The monitor has not been opened.",
                close: false
            });
            return;
        }
        // initialize RTCPeerConnection
        initPeer();
        // create an offer
        myPeerConnection.createOffer().then(function (offer) {
            myPeerConnection.setLocalDescription(offer);
            sendToServer({
                type: "offer",
                offer: offer
            });
        }).catch(function (error) {
            alert("Error when creating an offer.");
        });
    }
}

