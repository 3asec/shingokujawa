const fs = require('fs');
const WebSocket = require('ws');
const crypto = require('crypto');
const axios = require('axios'); // Make sure axios is installed

const TELEGRAM_BOT_TOKEN = '7294543045:AAG_nGUQi03Xe6GjyC3GoXGxn2zN2qavWS8';
const TELEGRAM_CHAT_ID = '5302209444';

const uri = 'wss://tongame-service-roy7ocqnoq-ew.a.run.app/socket.io/?EIO=4&transport=websocket';
const options = (accessToken) => ({
    headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Origin': 'https://netcoin.layernet.ai',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; M2012K11AG Build/TKQ1.220829.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13'
    }
});

fs.readFile('tokens.txt', 'utf8', (err, data) => {
    if (err) {
        console.error('Failed to read tokens file:', err);
        return;
    }

    const tokens = data.split('\n').filter(token => token.trim().length > 0);

    // Process each token in parallel
    Promise.all(tokens.map((token, index) => {
        return new Promise((resolve) => {
            setTimeout(() => {
                connect(token.trim(), index + 1, resolve); // Pass the resolve function to connect
            }, index * 5000); // Delay of 5 seconds between each connection
        });
    })).then(() => {
        console.log('All accounts connected.');
    });
});

function sendTelegramMessage(accountNumber, gameData, totalCoinsEarned) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const message = `
🎱🎱 Layernet 🎱🎱

👤 Account: ${accountNumber}
⏳ Duration: ${gameData.duration}
🔧 Durability: ${gameData.durability}
💰 Gold: ${gameData.gold}
📈 Progress: ${gameData.progress.toFixed(2)}

============================

💰 Total Gold Earned: ${totalCoinsEarned}
    `;
    axios.post(url, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
    }).catch(error => {
        console.error('Failed to send message:', error);
    });
}

function connect(accessToken, accountNumber, resolve) {
    let ws;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    let eventTypeNumber = 0;
    let totalCoinsEarned = 0;
    let currentRound = 5;
    let gameStarted = false;
    let homeDataSent = false;
    let isSendingMessage = false;
    let shouldSendInGameMessages = true;
    
    let lastGameData = {}; // Store last game data to detect changes

    function attachWebSocketHandlers() {
        ws.on('open', function open() {
            console.log(`Account #${accountNumber} | WebSocket connection opened for token: ${accessToken}`);
            reconnectAttempts = 0;
            ws.send('40{"token": "Bearer ' + accessToken + '"}');
        });

        ws.on('message', function incoming(data) {
            const message = data.toString();
            const typeMatch = message.match(/^(\d+)/);
            if (typeMatch) {
                const type = typeMatch[1];
                const content = message.substring(type.length);
                try {
                    if (content.startsWith('[') || content.startsWith('{')) {
                        const json = JSON.parse(content);
                        if (Array.isArray(json) && json.length > 0) {
                            const data = json[0];

                            // Check for new claims
                            if (data?.claim > 1000) {
                                claim();
                            }

                            // Log and display user rank
                            if (data.userRank) {
                                console.log(`Account #${accountNumber} | Rank: ${data.userRank.role} | Per Hour: ${data.userRank.profitPerHour} | Gold: ${(data.gold / 1000).toFixed(3)} | Dogs: ${data.dogs}`);
                            }

                            // Start game if not started
                            if (!gameStarted) {
                                console.log(`Account #${accountNumber} | Starting game...`);
                                startGame();
                                gameStarted = true;
                            }

                            // Handle game data
                            if (json[0] && json[0].duration) {
                                const gameData = json[0];

                                // Compare with lastGameData to avoid duplicate messages
                                if (JSON.stringify(gameData) !== JSON.stringify(lastGameData)) {
                                    lastGameData = gameData; // Update lastGameData

                                    console.log(`Account #${accountNumber} | Game started round ${currentRound} | Duration: ${gameData.duration} | Durability: ${gameData.durability} | Gold: ${gameData.gold} | Progress: ${gameData.progress}`);
                                    
                                    if (gameData.durability === 0 && gameData.gameover) {
                                        console.log(`Account #${accountNumber} | Game Selesai | Coin: ${gameData.gold}`);
                                        totalCoinsEarned += gameData.gold;
                                        console.log(`Account #${accountNumber} | Total Coin Earned: ${totalCoinsEarned}`);
                                        eventTypeNumber = 0;
                                        gameStarted = false;
                                        startGame();
                                        sendTelegramMessage(accountNumber, gameData, totalCoinsEarned); // Send message with detailed info
                                    } else if (gameData.durability >= 0) {
                                        sendInGameMessage(gameData);
                                    }
                                }
                            }
                        } else {
                            console.log(`Account #${accountNumber} | Non-JSON Message Content:`, content);
                        }
                    } else {
                        console.log(`Account #${accountNumber} | Failed to extract type from message:`, message);
                    }
                } catch (err) {
                    console.error(`Account #${accountNumber} | Failed to parse JSON:`, err);
                }
            } else {
                console.error(`Account #${accountNumber} | Failed to extract type from message:`, message);
            }

            if (message.includes('40') && !homeDataSent) {
                sendHomeData();
                homeDataSent = true;
            }
        });

        ws.on('error', function error(err) {
            console.error(`Account #${accountNumber} | WebSocket error for token: ${accessToken}`, err);
        });

        ws.on('close', function close(code, reason) {
            console.log(`Account #${accountNumber} | WebSocket connection closed for token: ${accessToken}`);
            console.log('Close code:', code);
            console.log('Close reason:', reason ? reason.toString() : 'No reason provided');
            shouldSendInGameMessages = false;
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                setTimeout(reconnect, 5000);
            } else {
                console.error('Max reconnect attempts reached. Giving up.');
                resolve();
            }
        });
    }

    function reconnect() {
        console.log('Attempting to reconnect...');
        connect(accessToken, accountNumber, resolve);
    }

    function sendHomeData() {
        ws.send(`42${eventTypeNumber}["homeData"]`);
    }

    function claim() {
        ws.send(`42["withdrawClaim"]`);
        eventTypeNumber++;
    }

    function startGame() {
        if (!gameStarted) {
            console.log(`Account #${accountNumber} | Sending startGame message...`);
            ws.send(`42${eventTypeNumber}["startGame"]`);
            eventTypeNumber++;
            gameStarted = true;
        } else {
            console.log(`Account #${accountNumber} | Game already started, not sending startGame message.`);
        }
    }

    function sendInGameMessage(gameData) {
        if (isSendingMessage || !shouldSendInGameMessages) return;

        isSendingMessage = true;

        const timestamp = Date.now();
        const message = `42${eventTypeNumber}["inGame",{"round":${currentRound},"time":${timestamp},"gameover":false}]`;
        console.log(`Account #${accountNumber} | Sending in-game message:`, message);
        ws.send(message);
        eventTypeNumber++;

        if (!gameData.gameover && gameData.durability > 0) {
            setTimeout(() => {
                isSendingMessage = false;
                sendInGameMessage(gameData);
            }, 500);
        } else {
            isSendingMessage = false;
        }
    }

    ws = new WebSocket(uri, options(accessToken));
    attachWebSocketHandlers();
}
