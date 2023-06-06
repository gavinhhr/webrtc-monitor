import websockets
import aiortc
from aiortc.contrib.media import MediaPlayer
from aiortc.sdp import candidate_from_sdp
import json
import asyncio
import time

# signaling server IP address
serverURL = "ws://47.115.205.65:9091"
# monitor ID in server
myID = "monitor"
# client ID in server
connectedID = None
# RTCPeerConnection object
myPeerConnection = None
# audio and video track
audioTrack = None
videoTrack = None
# whether RTCPeerConnection has been created
RTCPeerConnectionCreated = False


async def sendToServer(myWebSocket, message: dict):
    # if client connected, send message to client through server
    if connectedID:
        # add receiver's ID to the message
        message.update({"ID": connectedID})
    # change dict to JSON string
    message = json.dumps(message)
    # send message
    await myWebSocket.send(message)


def initPC():
    global myPeerConnection
    global RTCPeerConnectionCreated
    # configure STUN/TURN server
    STUNServer = aiortc.RTCIceServer(urls="stun:47.115.205.65:3478")
    TURNServer = aiortc.RTCIceServer(urls="urls",
                                     username="username",
                                     credential="credential")
    configuration = aiortc.RTCConfiguration(
        iceServers=[STUNServer, TURNServer])
    # initialize RTCPeerConnection
    try:
        # create RTCPeerConnection and add track to be sent
        myPeerConnection = aiortc.RTCPeerConnection(
            configuration=configuration)
        if audioTrack != None:
            myPeerConnection.addTrack(audioTrack)
        if videoTrack != None:
            setCodec(myPeerConnection.addTrack(videoTrack), "video/H264")

        # add event listener
        @myPeerConnection.on("connectionstatechange")
        async def on_connectionstatechange():
            print("Connection state is %s." % myPeerConnection.connectionState)

        @myPeerConnection.on("iceconnectionstatechange")
        async def on_iceconnectionstatechange():
            print("ICE connection state is %s." %
                  myPeerConnection.iceConnectionState)
            if myPeerConnection.iceConnectionState == "closed":
                await handleLeave()

        @myPeerConnection.on("icegatheringstatechange")
        async def on_icegatheringstatechange():
            print("ICE gathering state is %s." %
                  myPeerConnection.iceGatheringState)

        @myPeerConnection.on("signalingstatechange")
        async def on_signalingstatechange():
            if myPeerConnection == None:
                return
            print("Signaling state is %s." % myPeerConnection.signalingState)
            if myPeerConnection.signalingState == "closed":
                await handleLeave()

        # create RTCPeerConnection successfully
        RTCPeerConnectionCreated = True
    except Exception as e:
        # create RTCPeerConnection failed
        print("Error occurred when creating RTCPeerConnection.")
        print(e, e.__traceback__.tb_lineno)


def setCodec(sender: aiortc.rtcpeerconnection.RTCRtpSender, forcedCodec: str):
    global myPeerConnection
    # assign codec used in RTCPeerConnection
    kind = forcedCodec.split("/")[0]
    codecs = aiortc.RTCRtpSender.getCapabilities(kind).codecs
    transceiver = next(t for t in myPeerConnection.getTransceivers()
                       if t.sender == sender)
    transceiver.setCodecPreferences(
        [codec for codec in codecs if codec.mimeType == forcedCodec])


def handleLogin(message: dict):
    # handle connection error
    if message["success"] == False:
        print("ID of WebCam has been used, try another ID.")


async def handleAnswer(message: dict):
    global myPeerConnection
    # handle answer string
    sdp = message["answer"]["sdp"]
    typ = message["answer"]["type"]
    try:
        await myPeerConnection.setRemoteDescription(
            aiortc.RTCSessionDescription(sdp=sdp, type=typ))
    except Exception as e:
        print("Error occurred when setting Remote Description.")
        print(e, e.__traceback__.tb_lineno)


async def handleCandidate(message: dict):
    global myPeerConnection
    # handle candidate string
    try:
        # remove candidate prefix
        candidate = message["candidate"]["candidate"][10:]
        # split candidate string by space
        candidate = candidate.split()
        # assign parameters
        component = int(candidate[1])
        foundation = candidate[0]
        ip = candidate[4]
        port = int(candidate[5])
        priority = int(candidate[3])
        protocol = candidate[2]
        typ = candidate[7]
        if "raddr" in candidate:
            relatedAddress = candidate[9]
        else:
            relatedAddress = None
        if "rport" in candidate:
            relatedPort = candidate[11]
        else:
            relatedPort = None
        sdpMid = message["candidate"]["sdpMid"]
        sdpMLineIndex = message["candidate"]["sdpMLineIndex"]
    except Exception as e:
        print("Error occurred when handling candidate string.")
        print(e, e.__traceback__.tb_lineno)
    # add ICE candidate
    try:
        await myPeerConnection.addIceCandidate(
            aiortc.RTCIceCandidate(component=component,
                                   foundation=foundation,
                                   ip=ip,
                                   port=port,
                                   priority=priority,
                                   protocol=protocol,
                                   type=typ,
                                   relatedAddress=relatedAddress,
                                   relatedPort=relatedPort,
                                   sdpMid=sdpMid,
                                   sdpMLineIndex=sdpMLineIndex))
    except Exception as e:
        print("Error occurred when adding ICE candidate.")
        print(e, e.__traceback__.tb_lineno)


async def handleCall(myWebSocket, message: dict):
    global connectedID
    global myPeerConnection
    global audioTrack
    global videoTrack
    # create Offer and setLocalDescription
    if len(message["receiver"]) > 0:
        # username of our stream's receiver
        connectedID = message["receiver"]
        # when client called, try to get video/audio stream
        try:
            # get camera
            videoTrack = MediaPlayer("/dev/video0",
                                     format="v4l2",
                                     options={
                                         "video_size": "640x480"
                                     }).video
            # get microphone
            audioTrack = MediaPlayer(file="hw:0,0",
                                     format="alsa",
                                     options={
                                         "channels": "1"
                                     }).audio
        except Exception as e:
            print("Error occurred when opening camera or microphone.")
            print(e, e.__traceback__.tb_lineno)
        # inform client that monitor is not opened
        if audioTrack and videoTrack == None:
            await sendToServer(
                myWebSocket, {
                    "type": "sendinfo",
                    "info": "The monitor has not been opened.",
                    "close": False
                })
            return
        # initialize RTCPeerConnection
        initPC()
        # create an offer
        try:
            # create offer to set up RTCPeerConnection
            offer = await myPeerConnection.createOffer()
            await myPeerConnection.setLocalDescription(offer)
            """
            It's strange that "sdp" in "offer" doesn't include self IP address, 
            so here use "sdp" in RTCPeerConnection.localDescription instead.
            """
            await sendToServer(
                myWebSocket, {
                    "type": "offer",
                    "offer": {
                        "type": offer.type,
                        "sdp": myPeerConnection.localDescription.sdp
                    }
                })
        except Exception as e:
            print("Error occurred when creating offer.")
            print(e, e.__traceback__.tb_lineno)


async def handleLeave():
    global myPeerConnection
    global RTCPeerConnectionCreated
    global connectedID
    # clear client username
    connectedID = None
    # disconnect RTCPeerConnection
    await myPeerConnection.close()
    RTCPeerConnectionCreated = False


async def onOpen(myWebSocket):
    # callback function when WebSocket opened
    # receive the information of successfully start WebSocket
    success = await myWebSocket.recv()
    print(success)
    # send connect information to the server
    await sendToServer(myWebSocket, {
        "type": "login",
        "ID": myID,
        "username": "0000",
        "password": "0000"
    })


async def onMessage(myWebSocket, message: str):
    # callback function when got message from server
    print("Got message: %s" % message)
    # load JSON string
    message = json.loads(message)
    # choose handle function according to the type of message
    messageType = message["type"]
    if (messageType == "login"):
        handleLogin(message)
    # receive answer from client
    elif (messageType == "answer"):
        await handleAnswer(message)
    # receive ICE candidate from client
    elif (messageType == "candidate"):
        await handleCandidate(message)
    # called by client, raise RTCPeerConnection
    elif (messageType == "call"):
        await handleCall(myWebSocket, message)
    # client disconnected
    elif (messageType == "leave"):
        await handleLeave()


async def onClose(myWebSocket):
    global audioTrack
    global videoTrack
    # inform website client we are going to hang up
    await sendToServer(
        myWebSocket, {
            "type": "sendinfo",
            "info": "Monitor disconnected to server.",
            "close": False
        })
    # log out from the server
    if connectedID == None:
        await sendToServer(myWebSocket, {"type": "leave", "ID": "undefined"})
    else:
        await sendToServer(myWebSocket, {"type": "leave"})
        # if has connected to client, close the RTCPeerConnection, otherwise, just stop getting stream
        await handleLeave()
    audioTrack = None
    videoTrack = None


async def WS():
    # connect to server through WebSocket
    print("Connecting to server...")
    while True:
        try:
            async with websockets.connect(serverURL) as myWebSocket:
                # callback function when connect to server successfully
                await onOpen(myWebSocket)
                while True:
                    try:
                        # receive message from server
                        message = await myWebSocket.recv()
                        # callback function to handle message
                        await onMessage(myWebSocket, message)
                    except KeyboardInterrupt as e:
                        # close program when keyboard interrupt
                        await onClose(myWebSocket)
                        print("Program closed due to keyboard interrupt.")
                        print(e, e.__traceback__.tb_lineno)
                        return
                    except websockets.exceptions.ConnectionClosedError as e:
                        print(
                            "Connection closed due to error occurred. Reconnection will start after 5s."
                        )
                        print(e, e.__traceback__.tb_lineno)
                        time.sleep(5)
                        break
        except Exception as e:
            print(
                "WebSocket cannot connect to server. Reconnection will start after 5s."
            )
            print(e, e.__traceback__.tb_lineno)
            time.sleep(5)


if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(WS())
