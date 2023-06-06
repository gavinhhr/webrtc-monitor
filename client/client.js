"use strict";

// html page widget
var loginPage = document.querySelector("#loginPage");
var callPage = document.querySelector("#callPage");
var loginBtn = document.querySelector("#loginBtn");
var callBtn = document.querySelector("#callBtn");
var remoteVideo = document.querySelector("#remoteVideo");

// signaling server IP address
var serverURL = "ws://" + location.hostname + ":9091";
// client ID in server
var myID = "client";
// monitor ID in server
var connectedID = null;
// WebSocket object, set up a WebSocket connection
var myWebSocket = new WebSocket(serverURL);
// RTCPeerConnection object
var myPeerConnection;
// camera stream from WebCam
var stream;
// whether RTCPeerConnection has been created
var RTCPeerConnectionCreated = false;

// setting the STUN/TURN server IP
const configuration = {
    "iceServers":
        [
            {
                "urls": "stun:47.115.205.65:3478",
            },
            {
                "urls": "turn:47.115.205.65:3478",
                "username": "hhr",
                "credential": "123456"
            }
        ]
};

/**
 * botton to log in
 */
loginBtn.addEventListener("click", function () {
    // get username and password
    var usernameInput = document.querySelector("#UsernameInput").value;
    var passwordInput = document.querySelector("#PasswordInput").value;
    // verify log in information by server
    if (usernameInput.length > 0 && passwordInput.length > 0) {
        sendToServer({
            type: "login",
            ID: myID,
            username: usernameInput,
            password: passwordInput
        });
        loginBtn.disabled = true;
    } else {
        alert("Please input your username and password.")
    }
})

/**
 * botton to inform WebCam to set up a RTCPeerConnection
 */
callBtn.addEventListener("click", function () {
    // initialize RTCPeerConnection
    initPeer();
    // choose a monitor to connect
    connectedID = "monitor"
    // inform WebCam to set up a RTCPeerConnection
    sendToServer({
        type: "call",
        selfID: myID
    });
});

/**
 * callback function when WebSocket connected
 */
myWebSocket.onopen = function () {
    console.log("Connected to the signaling server.");
};

/**
 * callback function when WebSocket got message
 * @param {*} message 
 */
myWebSocket.onmessage = function (message) {
    // print message in console
    console.log("Got message: ", message.data);
    // load JSON string
    var data = JSON.parse(message.data);
    switch (data.type) {
        // log in to server
        case "login":
            handleLogin(data.success);
            break;
        // WebCam raised RTCPeerConnection
        case "offer":
            handleOffer(data.offer, data.ID);
            break;
        // receive ICE candidate from WebCam
        case "candidate":
            handleCandidate(data.candidate);
            break;
        // avoid call from user who hasn't logged in
        case "call":
            alert("Please log in at first.")
            window.location.reload();
            break;
        // WebCam disconnect
        case "leave":
            handleLeave();
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

/**
 * callback function when WebSocket got error
 * @param {} err 
 */
myWebSocket.onerror = function (err) {
    console.log("Got error: ", err);
};

/**
 * send message to server
 * @param message
 */
function sendToServer(message) {
    // if client connected, send message to client through server
    if (connectedID) {
        message.ID = connectedID;
    }
    myWebSocket.send(JSON.stringify(message));
};

/**
 * initialize the RTCPeerConnection
 * @returns 
 */
function initPeer() {
    // add prefix
    let PeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    try {
        myPeerConnection = new PeerConnection(configuration);
        // set up stream listener
        if ("ontrack" in myPeerConnection) {
            // when WebCam adds stream to the peer connection, display it
            console.log("Use ontrack.");
            myPeerConnection.ontrack = async function (event) {
                remoteVideo.srcObject = event.streams[0];
                callBtn.disabled = true;
            };
        } else {
            // when WebCam adds stream to the peer connection, display it
            console.log("Use onaddstream.");
            myPeerConnection.onaddstream = async function (event) {
                remoteVideo.srcObject = event.stream;
                callBtn.disabled = true;
            };
        }
        // Set up ICE candidate listener
        myPeerConnection.onicecandidate = async function (event) {
            // when we get self IP address, send it to the WebCam
            if (event.candidate) {
                sendToServer({
                    type: "candidate",
                    candidate: event.candidate
                });
            }
        };
        // set up ICE connection listener
        myPeerConnection.oniceconnectionstatechange = async function (event) {
            console.log("ICE connection state is " + myPeerConnection.iceConnectionState + ".");
            switch (myPeerConnection.iceConnectionState) {
                case "closed":
                case "failed":
                case "disconnected":
                    handleLeave();
                    break;
            }
        };
        // set up ICE gathering listener
        myPeerConnection.onicegatheringstatechange = async function (event) {
            console.log("ICE gathering state is " + myPeerConnection.iceGatheringState + ".");
        };
        // set up signaling state listener
        myPeerConnection.onsignalingstatechange = async function (event) {
            if (myPeerConnection == null) {
                return;
            }
            console.log("Signaling state is " + myPeerConnection.signalingState + ".");
            switch (myPeerConnection.signalingState) {
                case "closed":
                    handleLeave();
                    break;
            }
        };
        // RTCPeerConnectionCreated has created
        RTCPeerConnectionCreated = true;
    } catch (e) {
        console.log("Failed to create PeerConnection: " + e.message);
        alert("Cannot create RTCPeerConnection object.");
        RTCPeerConnectionCreated = false;
        return;
    }
}

/**
 * when server sends log in reply
 * @param success
 */
function handleLogin(success) {
    if (success === false) {
        alert("Username or password is wrong, try again.");
        loginBtn.disabled = false;
    } else {
        loginPage.style.display = "none";
        callPage.style.display = "flex";
    }
};

/**
 * when WebCam sends us offer
 * @param offer offer content
 * @param ID  username of whom send offer
 * @returns {Promise<void>}
 */
async function handleOffer(offer, ID) {
    // setup a new connection if RTCPeerConnection hasn't been created
    if (RTCPeerConnectionCreated == false) {
        initPeer();
    }
    connectedID = ID;
    // handle offer
    await myPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    // create answer
    myPeerConnection.createAnswer().then(function (answer) {
        myPeerConnection.setLocalDescription(answer);
        sendToServer({
            type: "answer",
            answer: answer
        });
    }).catch(function (error) {
        alert("Error when creating answer.");
    });
};

/**
 * when we get IP address of WebCam
 * @param candidate ICE candidate
 */
function handleCandidate(candidate) {
    myPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
};

/**
 * when monitor disconnect
 */
function handleLeave() {
    // clear WebCam username
    connectedID = null;
    // close video on page
    remoteVideo.src = null;
    // close RTCPeerConnection
    myPeerConnection.close();
    myPeerConnection = null;
    RTCPeerConnectionCreated = false;
    // enable call button on page
    callBtn.disabled = false;
};
