var express = require('express');
var http = require('http');
var WebSocketServer = require('ws').Server;

// server app object
var app = express();
// create client server on port 9090
var server = http.Server(app);
server.listen(9090, function () {
    console.log('Listening on *:9090.');
});
// create WebSocket server on port 9091
var ws = new WebSocketServer({ port: 9091 });
// set the client page address
app.use(express.static('client'));
// set the client page file
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/client/client.html');
});

// ID of all users connected to the server
var ID = {};
// username and password of monitor/client
var certificate = { "0000": "0000", "hhr": "123456" };

/**
 * when a user connected to server
 * @param connection user who raise connection
 * @param ID[data.ID] ID of user who will be connected
 */
ws.on('connection', function (connection) {
    // when server got message from a connected user
    connection.on('message', function (message) {
        var data;
        // only accept JSON message
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.log("Got invalid JSON string.");
            data = {};
        }
        // switch type of message
        switch (data.type) {
            // when a user tries to connect
            case "login":
                console.log(data.ID + " trying to log in.")
                // verify username and password
                if (data.username in certificate && certificate[data.username] == data.password) {
                    // do not allow users with same ID to connect
                    if (ID[data.ID]) {
                        sendToUser(connection, {
                            type: "login",
                            success: false
                        });
                        console.log(data.ID + " failed to log in.");
                    } else {
                        // save user connection on the server
                        connection.ID = data.ID;
                        ID[data.ID] = connection;
                        sendToUser(connection, {
                            type: "login",
                            success: true
                        });
                        console.log(data.ID + " succeeded to log in.");
                    }
                } else {
                    sendToUser(connection, {
                        type: "login",
                        success: false
                    })
                    console.log("Client failed to log in.")
                }
                break;
            case "offer":
                // monitor sends offer to client
                console.log("Sending offer to " + data.ID + ".");
                // if client exists then send offer to it, otherwise, inform the monitor.
                var connection_ = ID[data.ID];
                if (connection_ != null) {
                    // log that monitor connected to client
                    connection.otherName = data.ID;
                    sendToUser(connection_, {
                        type: "offer",
                        offer: data.offer,
                        ID: connection.ID
                    });
                } else {
                    // no client connected to server
                    sendToUser(connection, {
                        type: "sendinfo",
                        info: "Client does not exist.",
                        close: false
                    });
                }
                break;
            case "answer":
                // client sends answer to monitor
                console.log("Sending answer to " + data.ID + ".");
                var connection_ = ID[data.ID];
                if (connection_ != null) {
                    connection.otherName = data.ID;
                    sendToUser(connection_, {
                        type: "answer",
                        answer: data.answer
                    });
                }
                break;
            case "candidate":
                // exchange ICE candidate information
                console.log("Sending ICE candidate to " + data.ID + ".");
                var connection_ = ID[data.ID];
                if (connection_ != null) {
                    sendToUser(connection_, {
                        type: "candidate",
                        candidate: data.candidate
                    });
                }
                break;
            case "call":
                // client calls monitor
                if (ID[data.selfID]) {
                    console.log('Calling ' + data.ID + ".");
                    var connection_ = ID[data.ID];
                    if (connection_ != null) {
                        sendToUser(connection_, {
                            type: "call",
                            receiver: connection.ID
                        });
                    }
                } else {
                    // avoid calling by client who hasn't logged in
                    sendToUser(connection, {
                        type: "call"
                    })
                }
                break;
            case "leave":
                // one user disconnecting to server
                console.log("Disconnected to " + connection.ID + ".");
                var connection_ = ID[data.ID];
                // inform the other user to close peer connection
                if (connection_ != null) {
                    sendToUser(connection_, {
                        type: "leave"
                    });
                    connection_.otherName = null;
                }
                delete ID[connection.ID];
                break;
            case "sendinfo":
                // inform the other user
                console.log("Sending information to " + data.ID + ".")
                var connection_ = ID[data.ID];
                if (connection_ != null) {
                    sendToUser(connection_, {
                        type: "sendinfo",
                        info: data.info,
                        close: data.close
                    });
                }
                break;
            default:
                sendToUser(connection, {
                    type: "error",
                    message: "Command not found: " + data.type + "."
                });
                break;
        }
    });

    // when client closed the browser window or monitor shut down
    connection.on("close", function () {
        console.log("Disconnected to " + connection.ID + ".");
        if (connection.ID) {
            delete ID[connection.ID];
            if (connection.otherName) {
                var connection_ = ID[connection.otherName];
                if (connection_ != null) {
                    sendToUser(connection_, {
                        type: "leave"
                    });
                    connection_.otherName = null;
                }
            }
        }
    });
    connection.send(JSON.stringify("Connected to server successfully."));
});

/**
 * send message to user
 * @param {*} connection target user/connection raised by target user
 * @param {*} message message to be sent
 */
function sendToUser(connection, message) {
    connection.send(JSON.stringify(message));
}
