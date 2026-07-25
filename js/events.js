// js/events.js
import { state, storage } from './state.js';
import { getWorkspace } from './db.js';
import { toggleAutoPlay, forceStopAIPlayers, jumpToNode, initGame, loadGameFromList } from './game.js';
import { triggerEngineEvaluation, applyEngineSettings, getDeviceTier } from './engine.js';
import { openModal, closeModal, updateTurnToggleUI, showLoading, hideLoading, showToast } from './ui.js';
import { finishEditing, turnOnEditMode } from './editor.js';
import { handleImageRecognition, handleFileUpload, getMoveListAndComments, copyToClipboard, getVschessNodeTree, downloadFile, getFormattedDate, formatGameInfoString, saveGameState } from './io.js';
import { renderBoardFull, drawBestMoveArrow, clearArrow } from './board.js';
import { START_FEN, VschessErrorDict } from './config.js';

function translateVschessError(errStr) {
    let trans = errStr;
    for (let key in VschessErrorDict) {
        trans = trans.replace(new RegExp(key, 'g'), VschessErrorDict[key]);
    }
    return trans;
}

function setupStepper(stateKey, inputId, minusId, plusId, min, defaultMax, step, isHash = false, targetType = 'ai') {
    const input = document.getElementById(inputId);
    const btnMinus = document.getElementById(minusId);
    const btnPlus = document.getElementById(plusId);
    if (!input || !btnMinus || !btnPlus) return;
    
    const hashValues = [32, 64, 128, 192, 256, 320, 384, 448, 512];

    let targetObj;
    if (targetType === 'ai') targetObj = state.aiSettings;
    else if (targetType === 'app') targetObj = state.appSettings;
    else if (targetType === 'bot') targetObj = state.vsBotSettings;

    if (targetObj[stateKey] !== undefined) {
        input.value = targetObj[stateKey];
    }

    function updateState(isFromUserClick = false) {
        // Lấy giới hạn Max động từ thuộc tính HTML (nếu engine.js đã can thiệp)
        let currentMax = parseFloat(input.getAttribute('max')) || defaultMax;
        let val = parseFloat(input.value);
        
        if (isNaN(val)) val = targetObj[stateKey];
        if (val < min) val = min;
        if (val > currentMax) val = currentMax; // Khóa theo Max Động
        
        if (isHash && !hashValues.includes(val)) {
            val = hashValues.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
        }

        input.value = val;
        targetObj[stateKey] = val;
        
        if (isFromUserClick) {
            if (targetType === 'ai') storage.saveAnalysis(state.aiSettings);
            else if (targetType === 'app') storage.saveSystem(state.appSettings);
            else if (targetType === 'bot') storage.saveVsBot(state.vsBotSettings);
        }
        
        btnMinus.disabled = val <= min;
        btnPlus.disabled = val >= currentMax; // Nút plus mờ đi dựa trên Max Động
    }

    btnMinus.onclick = () => {
        let val = parseFloat(input.value);
        if (isHash) {
            let idx = hashValues.indexOf(val);
            if (idx > 0) input.value = hashValues[idx - 1];
        } else {
            if (val - step >= min) input.value = val - step;
        }
        updateState(true);
        
        if (inputId === 'input-setup-level') document.getElementById('input-botlevel').value = input.value;
        if (inputId === 'input-botlevel') document.getElementById('input-setup-level').value = input.value;
    };

    btnPlus.onclick = () => {
        let currentMax = parseFloat(input.getAttribute('max')) || defaultMax;
        let val = parseFloat(input.value);
        if (isHash) {
            let idx = hashValues.indexOf(val);
            // Chỉ cho tăng Hash nếu mốc tiếp theo <= Max Động
            if (idx < hashValues.length - 1 && hashValues[idx + 1] <= currentMax) {
                input.value = hashValues[idx + 1];
            }
        } else {
            if (val + step <= currentMax) input.value = val + step;
        }
        updateState(true);
        
        if (inputId === 'input-setup-level') document.getElementById('input-botlevel').value = input.value;
        if (inputId === 'input-botlevel') document.getElementById('input-setup-level').value = input.value;
    };

    input.onblur = () => updateState(true);
    input.oninput = function() { this.value = this.value.replace(/[^0-9.]/g, ''); };
    
    updateState(false); 
}
function resetAIUI() {
    if (!state.isAnalyzing && !state.aiPlaysRed && !state.aiPlaysBlack) {
        import('./engine.js').then(module => {
            module.forceStopEngine(); // Dùng hàm mới thay vì gửi chữ "stop"
        });
    }
}

async function switchMode(newMode, customFen = START_FEN) {
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
    let targetMenuId = `menu-${newMode}`;
    if (newMode === 'vsbot') targetMenuId = 'menu-bot'; 

    const activeBtn = document.getElementById(targetMenuId);
    if (activeBtn) activeBtn.classList.add('menu-item-active');

    if (state.appMode === newMode && customFen === START_FEN) {
        closeModal('main-menu-modal');
        return;
    }

    showLoading("Đang tải dữ liệu...");

    // TẮT TRIỆT ĐỂ TOÀN BỘ CÁC TRẠNG THÁI VÀ NÚT AI TRƯỚC KHI ĐỔI MODE
    state.isAnalyzing = false;
    state.aiPlaysRed = false;
    state.aiPlaysBlack = false;

    const btnAnalyze = document.getElementById('btn-analyze');
    if (btnAnalyze) btnAnalyze.classList.remove('tool-active');

    const btnRed = document.getElementById('btn-ai-red');
    if (btnRed) btnRed.classList.remove('tool-active');

    const btnBlack = document.getElementById('btn-ai-black');
    if (btnBlack) btnBlack.classList.remove('tool-active');
    
    if (state.engineModule) {
        state.engineModule.sendCommand("stop");
    }

    // Đợi 50ms cho trình duyệt kịp render cái UI Loading hiện lên màn hình
    setTimeout(async () => {
        closeModal('main-menu-modal');
        forceStopAIPlayers();
        
        state.appMode = newMode;
        state.appSettings.appMode = newMode;
        
        try { storage.saveSystem(state.appSettings); } catch(e) {}

        // SỬA: Đợi hàm initGame (chứa inflateTree tốn CPU) chạy xong hoàn toàn
        if (customFen !== START_FEN) {
            await initGame(customFen, false); 
        } else {
            await initGame(START_FEN, true); 
        }
        
        // Sau khi dữ liệu đã sẵn sàng trên bàn cờ, mới tắt Loading
        hideLoading(); 
    }, 50);
}

export function initEvents() {

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('main-menu-panel');
        const btnMenu = document.getElementById('btn-menu');
        if (menu && menu.classList.contains('show-menu') && !menu.contains(e.target) && !btnMenu.contains(e.target)) {
            closeModal('main-menu-modal'); 
        }
    });

    document.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        if (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') return;

        if (state.appMode === 'vsbot') {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
                showToast("Bạn không thể tiến/lùi cờ trong chế độ Đấu Máy!");
                return;
            }
        }

        switch (e.code) {
            case 'ArrowUp': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay(); 
                if(state.currentNode !== state.rootNode) { forceStopAIPlayers(); jumpToNode(state.rootNode); triggerEngineEvaluation(); }
                break;
            case 'ArrowDown': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay();
                if(state.currentNode.children.length) {
                    forceStopAIPlayers();
                    let temp = state.currentNode; 
                    while(temp.children.length) temp = temp.children[temp.mainLineIndex]; 
                    jumpToNode(temp); triggerEngineEvaluation(); 
                }
                break;
            case 'ArrowLeft': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay(); 
                if(state.currentNode.parent) jumpToNode(state.currentNode.parent); 
                break;
            case 'ArrowRight': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay(); 
                if(state.currentNode.children.length) jumpToNode(state.currentNode.children[state.currentNode.mainLineIndex]); 
                break;
            case 'Space': 
                e.preventDefault(); 
                toggleAutoPlay();
                break;
        }
    });

    const btnUndo = document.getElementById('btn-undo');
    if (btnUndo) {
        btnUndo.onclick = () => {
            if (btnUndo.classList.contains('disabled')) return;
            import('./game.js').then(module => {
                module.undoVsBot();
            });
        };
    }

    const btnHint = document.getElementById('btn-hint');
    if (btnHint) {
        btnHint.onclick = () => {
            if (btnHint.classList.contains('disabled') || !state.engineModule) return;
            
            const styleName = state.vsBotSettings.botStyle === 'human' ? 'Giống người' : 'Tiêu chuẩn';
            showToast(`💡 AI đang dùng Level 10 (${styleName}) để nghĩ nước đi...`);
            
            btnHint.classList.add('disabled');
            
            import('./engine.js').then(module => {
                module.triggerHintEvaluation();
            });
        };
    }

    function checkVsBotNav(e) {
        if (state.appMode === 'vsbot') {
            e.preventDefault(); e.stopPropagation();
            showToast("Bạn không thể tiến/lùi cờ trong chế độ Đấu Máy!");
            return true;
        }
        return false;
    }

    const btnAutoPlay = document.getElementById('btn-auto-play');
    if(btnAutoPlay) btnAutoPlay.onclick = (e) => { if(checkVsBotNav(e)) return; toggleAutoPlay(); };
    
    const btnStart = document.getElementById('btn-start');
    if(btnStart) btnStart.onclick = (e) => { 
        if(checkVsBotNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode !== state.rootNode) { forceStopAIPlayers(); jumpToNode(state.rootNode); triggerEngineEvaluation(); }
    };
    
    const btnPrev = document.getElementById('btn-prev');
    if(btnPrev) btnPrev.onclick = (e) => { 
        if(checkVsBotNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode.parent) { forceStopAIPlayers(); jumpToNode(state.currentNode.parent); }
    };
    
    const btnNext = document.getElementById('btn-next');
    if(btnNext) btnNext.onclick = (e) => { 
        if(checkVsBotNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode.children.length) { forceStopAIPlayers(); jumpToNode(state.currentNode.children[state.currentNode.mainLineIndex]); }
    };
    
    const btnEnd = document.getElementById('btn-end');
    if(btnEnd) btnEnd.onclick = (e) => { 
        if(checkVsBotNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay();
        if(state.currentNode.children.length) {
            forceStopAIPlayers();
            let temp = state.currentNode; 
            while(temp.children.length) temp = temp.children[temp.mainLineIndex]; 
            jumpToNode(temp); triggerEngineEvaluation(); 
        }
    };

    const btnMenu = document.getElementById('btn-menu');
    if(btnMenu) {
        btnMenu.onclick = () => { 
            btnMenu.classList.add('tool-active'); 
            setTimeout(() => btnMenu.classList.remove('tool-active'), 200); 
            
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
            let currentModeId = `menu-${state.appMode}`;
            if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
            
            const activeBtn = document.getElementById(currentModeId);
            if(activeBtn) {
                activeBtn.classList.add('menu-item-active');
            }

            openModal('main-menu-modal');
        };
    }

    const btnCloseMainMenu = document.getElementById('btn-close-main-menu');
    if(btnCloseMainMenu) btnCloseMainMenu.onclick = () => { closeModal('main-menu-modal'); };
    
    const menuAnalyze = document.getElementById('menu-analyze');
    if(menuAnalyze) menuAnalyze.onclick = () => { switchMode('analyze'); };
    
    // ====== Đấu Vs Bot ======
    const menuBot = document.getElementById('menu-bot');
    if(menuBot) {
        // THÊM ASYNC VÀO ĐÂY
        menuBot.onclick = async () => { 
            try {
                // Kiểm tra xem Workspace của Bot trong IndexedDB có dữ liệu không
                const workspace = await getWorkspace('vsbot_workspace');
                
                if (workspace && workspace.gameList && workspace.gameList.length > 0) {
                    switchMode('vsbot');// Nếu có ván cờ cũ -> Vào thẳng chế độ Bot (switchMode sẽ tự gọi initGame load từ DB)
                } else {
                    state.vsBotSetupOrigin = 'menu'; // Nếu trống trơn -> Bật Panel Thiết lập
                    closeModal('main-menu-modal');
                    document.getElementById('setup-bot-fen').value = START_FEN;
                    document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                    openModal('vsbot-setup-modal');
                }
            } catch (e) {
                // Đề phòng lỗi DB, mặc định bật Panel
                state.vsBotSetupOrigin = 'menu';
                closeModal('main-menu-modal');
                openModal('vsbot-setup-modal');
            }
        };
    }
    // Modal Thiết lập Ván đấu BOT
    document.getElementById('btn-setup-cancel').onclick = () => {
        closeModal('vsbot-setup-modal');
        
        if (state.vsBotSetupOrigin === 'menu') {
            openModal('main-menu-modal');
        } 
        else if (state.vsBotSetupOrigin === 'import_mode') {
            // Không làm gì cả, màn hình vẫn giữ nguyên ván cờ cũ
        }
        else if (state.vsBotSetupOrigin === 'edit_mode') {
            state.currentNode = state.preEditNode;
            state.currentStepNum = state.preEditStepNum;
            state.currentSituation = vschess.fenToSituation(state.currentNode.fen);
            
            renderBoardFull(state.currentSituation); 
            renderMoveHistory();
            
            const commentBox = document.getElementById('comment-box');
            if (commentBox) commentBox.value = state.currentNode.comment || "";
            
            if (state.vsBotSettings.botColor === 'red') state.aiPlaysRed = true;
            else state.aiPlaysBlack = true;
            
            triggerEngineEvaluation();
            
            import('./game.js').then(module => module.updateVsBotToolButtons());
        }
    };
    document.getElementById('btn-setup-confirm').onclick = () => {
        let fenInput = document.getElementById('setup-bot-fen').value.trim();
        if (fenInput.includes("moves")) {
            showToast("❌ Không được nhập biên bản nước đi. Chỉ chấp nhận mã hình cờ FEN!");
            return;
        }

        if (!fenInput.includes(" w ") && !fenInput.includes(" b ")) {
            fenInput += " w - - 0 1";
        }

        const errorList = vschess.checkFen(fenInput);
        if (errorList && errorList.length > 0) {
            const vnError = translateVschessError(errorList[0]);
            showToast(`❌ ${vnError}`);
            return;
        }

        const isRedTurn = fenInput.split(" ")[1] === "w";
        const botRole = document.getElementById('setup-bot-first').value; 
        
        if (botRole === 'bot') {
            state.vsBotSettings.botColor = isRedTurn ? "red" : "black";
        } else {
            state.vsBotSettings.botColor = isRedTurn ? "black" : "red";
        }

        state.vsBotSettings.botStyle = document.getElementById('setup-bot-style').value;
        
        const mainStyle = document.getElementById('input-bot-style');
        if(mainStyle) mainStyle.value = state.vsBotSettings.botStyle;
        
        storage.saveVsBot(state.vsBotSettings);
        
        closeModal('vsbot-setup-modal');

        if (state.appMode === 'vsbot') {
            initGame(fenInput, false); 
        } else {
            switchMode('vsbot', fenInput); 
        }
    };
    // =========================

    const menuBlind = document.getElementById('menu-blind');
    if(menuBlind) {
        menuBlind.onclick = async () => { 
            try {
                // Kiểm tra xem Workspace của Cờ Mù trong IndexedDB có dữ liệu không
                const workspace = await getWorkspace('blind_workspace');
                
                if (workspace && workspace.gameList && workspace.gameList.length > 0) {
                    switchMode('blind'); // Load ván cũ
                } else {
                    switchMode('blind', START_FEN); // Khởi tạo ván mới
                }
            } catch (e) {
                switchMode('blind', START_FEN);
            }
        };
    }

    const menuPuzzle = document.getElementById('menu-puzzle');
    if(menuPuzzle) menuPuzzle.onclick = () => { 
        closeModal('main-menu-modal'); 
        showToast("Tính năng đang được phát triển!");  
    };
    
    const menuOpening = document.getElementById('menu-memorize');
    if(menuOpening) menuOpening.onclick = () => { 
        closeModal('main-menu-modal'); 
        showToast("Tính năng đang được phát triển!"); 
     };

    
    const menuSettings = document.getElementById('menu-settings');
    if(menuSettings) menuSettings.onclick = () => { 
        closeModal('main-menu-modal'); 
        
        if (state.appMode === 'vsbot') {
            document.getElementById('settings-group-pikafish').style.display = 'none';
            document.getElementById('settings-group-vsbot').style.display = 'block';
        } else {
            document.getElementById('settings-group-pikafish').style.display = 'block';
            document.getElementById('settings-group-vsbot').style.display = 'none';
        }

        openModal('settings-modal'); 
    };

    const btnSettingsBack = document.getElementById('btn-settings-back');
    if(btnSettingsBack) btnSettingsBack.onclick = () => { 
        closeModal('settings-modal'); 
        if (state.appMode !== 'vsbot') applyEngineSettings(); 
        
        document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
        let currentModeId = `menu-${state.appMode}`;
        if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
        
        const activeBtn = document.getElementById(currentModeId);
        if(activeBtn) activeBtn.classList.add('menu-item-active');
            
        openModal('main-menu-modal'); 
    };

    let maxThreads = 1; 
    if (navigator.deviceMemory) {
        maxThreads = Math.max(1, Math.floor(navigator.deviceMemory / 2));
    } else if (navigator.hardwareConcurrency) {
        maxThreads = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2));
    }
    if (maxThreads > 16) maxThreads = 16;
    
    // --- LẤY TIER THIẾT BỊ ĐỂ SETUP GIAO DIỆN ---
    const tier = getDeviceTier();
    let maxHash = 512, maxDepth = 100;
    if (tier === 'MOBILE_HIGH') { maxHash = 512; maxDepth = 60; }
    if (tier === 'MOBILE_LOW') { maxHash = 128; maxDepth = 30; maxThreads = 1; }

    const inputThreads = document.getElementById('input-threads');
    if (inputThreads) inputThreads.max = maxThreads;
    
    const descThreads = document.getElementById('desc-threads');
    if (descThreads) descThreads.innerText = tier === 'MOBILE_LOW' ? `Tối đa: 1 luồng (Dành cho máy yếu)` : `Tối đa: ${maxThreads} luồng (Tự động theo RAM)`;

    if (state.aiSettings.threads > maxThreads) {
        state.aiSettings.threads = maxThreads;
        if (inputThreads) inputThreads.value = maxThreads;
    }

    // Cập nhật thuộc tính DOM trước khi setup
    document.getElementById('input-hash')?.setAttribute('max', maxHash);
    document.getElementById('input-depth')?.setAttribute('max', maxDepth);

    setupStepper('skill', 'input-skill', 'btn-skill-minus', 'btn-skill-plus', 0, 20, 1, false, 'ai');
    setupStepper('threads', 'input-threads', 'btn-threads-minus', 'btn-threads-plus', 1, maxThreads, 1, false, 'ai');
    
    // Chèn maxHash và maxDepth động vào Giao diện
    setupStepper('hash', 'input-hash', 'btn-hash-minus', 'btn-hash-plus', 32, maxHash, 32, true, 'ai');
    setupStepper('multiPV', 'input-multipv', 'btn-multipv-minus', 'btn-multipv-plus', 1, 5, 1, false, 'ai');
    setupStepper('moveTime', 'input-time', 'btn-time-minus', 'btn-time-plus', 0.5, 300, 0.5, false, 'ai');
    setupStepper('depth', 'input-depth', 'btn-depth-minus', 'btn-depth-plus', 1, maxDepth, 1, false, 'ai');
    
    setupStepper('cloudBookLimit', 'input-cloudlimit', 'btn-cloudlimit-minus', 'btn-cloudlimit-plus', 1, 50, 1, false, 'app');
    
    setupStepper('level', 'input-botlevel', 'btn-botlevel-minus', 'btn-botlevel-plus', 1, 10, 1, false, 'bot');
    setupStepper('level', 'input-setup-level', 'btn-setup-level-minus', 'btn-setup-level-plus', 1, 10, 1, false, 'bot');
    
    const inputBotStyle = document.getElementById('input-bot-style');
    if(inputBotStyle) {
        inputBotStyle.value = state.vsBotSettings.botStyle || "standard";
        inputBotStyle.onchange = (e) => {
            state.vsBotSettings.botStyle = e.target.value;
            storage.saveVsBot(state.vsBotSettings); 
            const setupStyle = document.getElementById('setup-bot-style');
            if(setupStyle) setupStyle.value = e.target.value;
            import('./game.js').then(module => module.updateVsBotToolButtons());
        };
    }
    
    const setupBotStyle = document.getElementById('setup-bot-style');
    if (setupBotStyle) {
        setupBotStyle.onchange = (e) => {
            state.vsBotSettings.botStyle = e.target.value;
            storage.saveVsBot(state.vsBotSettings);
            if (inputBotStyle) inputBotStyle.value = e.target.value;
            import('./game.js').then(module => module.updateVsBotToolButtons());
        };
    }

    const toggleAnimation = document.getElementById('toggle-animation');
    const toggleArrows = document.getElementById('toggle-arrows');
    const toggleSound = document.getElementById('toggle-sound');
    const toggleCloudbook = document.getElementById('toggle-cloudbook');

    if(toggleAnimation) toggleAnimation.checked = state.appSettings.animation;
    if(toggleArrows) toggleArrows.checked = state.appSettings.arrows;
    if(toggleSound) toggleSound.checked = state.appSettings.sound;
    if(toggleCloudbook) toggleCloudbook.checked = state.appSettings.cloudBookEnabled;

    if(toggleAnimation) toggleAnimation.onchange = (e) => {
        state.appSettings.animation = e.target.checked;
        storage.saveSystem(state.appSettings);
    };
    if(toggleArrows) {
        toggleArrows.onchange = (e) => {
            state.appSettings.arrows = e.target.checked;
            storage.saveSystem(state.appSettings);
            drawBestMoveArrow();
        };
    }
    if(toggleSound) toggleSound.onchange = (e) => {
        state.appSettings.sound = e.target.checked;
        storage.saveSystem(state.appSettings);
    };
    if(toggleCloudbook) toggleCloudbook.onchange = (e) => {
        state.appSettings.cloudBookEnabled = e.target.checked;
        storage.saveSystem(state.appSettings);
    };

    const btnImport = document.getElementById('btn-import');
    if(btnImport) btnImport.onclick = () => { 
        const btnImportFile = document.getElementById('btn-import-file');
        const importText = document.getElementById('import-text');
        
        // Cấu hình giao diện Panel Import tùy theo Mode
        if (state.appMode === 'vsbot') {
            if (btnImportFile) btnImportFile.style.display = 'none'; // Ẩn nút tải file
            if (importText) importText.placeholder = "Chỉ dán mã FEN hình cờ tĩnh vào đây...";
        } else {
            if (btnImportFile) btnImportFile.style.display = 'flex'; // Hiện nút tải file
            if (importText) importText.placeholder = "Dán mã FEN, PGN hoặc UBB vào đây...";
        }
        
        openModal('import-modal'); 
    };
    
    const btnExport = document.getElementById('btn-export');
    if(btnExport) btnExport.onclick = () => { openModal('export-modal'); };

    const btnFlip = document.getElementById('btn-flip');
    if(btnFlip) {
        btnFlip.onclick = (e) => {
            state.isBoardFlipped = !state.isBoardFlipped; 
            if(state.isBoardFlipped) { 
                document.getElementById('chess-board-area').classList.add('board-flipped'); btnFlip.classList.add('tool-active');
            } else { 
                document.getElementById('chess-board-area').classList.remove('board-flipped'); btnFlip.classList.remove('tool-active');
            }
        };
    }

    const btnPeek = document.getElementById('btn-peek');
    if (btnPeek) {
        btnPeek.onclick = () => {
            state.isPeeking = !state.isPeeking;
            const eyeClosed = document.getElementById('icon-eye-closed');
            const eyeOpen = document.getElementById('icon-eye-open');
            
            if (state.isPeeking) {
                btnPeek.classList.add('tool-active');
                if (eyeClosed) eyeClosed.style.display = 'none';
                if (eyeOpen) eyeOpen.style.display = 'block';
            } else {
                btnPeek.classList.remove('tool-active');
                if (eyeClosed) eyeClosed.style.display = 'block';
                if (eyeOpen) eyeOpen.style.display = 'none';
            }
            
            import('./board.js').then(module => {
                module.renderBoardFull(state.currentSituation);
            });
        };
    }

    const btnRed = document.getElementById('btn-ai-red');
    const btnBlack = document.getElementById('btn-ai-black');
    const btnAnalyze = document.getElementById('btn-analyze');

    function toggleAI(colorFlag) {
        if (colorFlag === 'red') {
            state.aiPlaysRed = !state.aiPlaysRed;
            if (state.aiPlaysRed) {
                if(btnRed) btnRed.classList.add('tool-active');
                state.isAnalyzing = false; if(btnAnalyze) btnAnalyze.classList.remove('tool-active');
            } else { if(btnRed) btnRed.classList.remove('tool-active'); }
        } 
        else if (colorFlag === 'black') {
            state.aiPlaysBlack = !state.aiPlaysBlack;
            if (state.aiPlaysBlack) {
                if(btnBlack) btnBlack.classList.add('tool-active');
                state.isAnalyzing = false; if(btnAnalyze) btnAnalyze.classList.remove('tool-active');
            } else { if(btnBlack) btnBlack.classList.remove('tool-active'); }
        }
        
        // ĐÃ SỬA: CHỈ gọi phân tích mới khi có ít nhất 1 chế độ đang được bật
        if (state.aiPlaysRed || state.aiPlaysBlack || state.isAnalyzing) {
            triggerEngineEvaluation();
        }
        resetAIUI();
    }

    if(btnRed) btnRed.onclick = () => toggleAI('red');
    if(btnBlack) btnBlack.onclick = () => toggleAI('black');

    if(btnAnalyze) {
        btnAnalyze.onclick = () => {
            state.isAnalyzing = !state.isAnalyzing;
            if (state.isAnalyzing) {
                btnAnalyze.classList.add('tool-active');
                state.aiPlaysRed = false; if(btnRed) btnRed.classList.remove('tool-active');
                state.aiPlaysBlack = false; if(btnBlack) btnBlack.classList.remove('tool-active');
                
                if (!state.hasAutoSwitchedToAnalyze) {
                    const pikaTab = document.querySelector('.ai-tab-btn[data-tab="pikafish"]');
                    if (pikaTab) pikaTab.click();
                    state.hasAutoSwitchedToAnalyze = true;
                }
                
                // BẬT THÌ CHẠY ĐÁNH GIÁ (Clear mũi tên cũ và tìm mũi tên mới)
                triggerEngineEvaluation(); 
            } else {
                // TẮT THÌ CHỈ CẦN THÁO NÚT ACTIVE (Không clear mũi tên)
                btnAnalyze.classList.remove('tool-active');
            }
            
            resetAIUI();
        };
    }

    if(btnRed) btnRed.onclick = () => toggleAI('red');
    if(btnBlack) btnBlack.onclick = () => toggleAI('black');

    if(btnAnalyze) {
        btnAnalyze.onclick = () => {
            state.isAnalyzing = !state.isAnalyzing;
            if (state.isAnalyzing) {
                btnAnalyze.classList.add('tool-active');
                state.aiPlaysRed = false; if(btnRed) btnRed.classList.remove('tool-active');
                state.aiPlaysBlack = false; if(btnBlack) btnBlack.classList.remove('tool-active');
                
                if (!state.hasAutoSwitchedToAnalyze) {
                    const pikaTab = document.querySelector('.ai-tab-btn[data-tab="pikafish"]');
                    if (pikaTab) pikaTab.click();
                    state.hasAutoSwitchedToAnalyze = true;
                }
            } else {
                btnAnalyze.classList.remove('tool-active');
            }
            
            triggerEngineEvaluation();
            resetAIUI();
        };
    }

    const btnGoInstant = document.getElementById('btn-go-instant');
    if(btnGoInstant) {
        btnGoInstant.onclick = () => {
            if (!state.isAnalyzing) {
                showToast("Vui lòng Bật chế độ 'Phân Tích' trước khi Đi ngay!");
                return; 
            }
            if (state.engineModule && vschess.hasLegalMove(state.currentSituation)) {
                btnGoInstant.classList.add('tool-active');
                
                // Gọi API mới để Xử lý Terminate tự động nếu là Single Thread
                import('./engine.js').then(module => {
                    module.triggerGoInstant();
                });
                
                const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
                if (isRedTurn) state.aiPlaysRed = true; else state.aiPlaysBlack = true;
                
                setTimeout(() => {
                    btnGoInstant.classList.remove('tool-active');
                    if (isRedTurn) state.aiPlaysRed = false; else state.aiPlaysBlack = false;
                }, 500);
            }
        };
    }

    document.querySelectorAll('.ai-tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.ai-tab-btn').forEach(b => b.classList.remove('tab-active'));
            e.target.classList.add('tab-active');
            const tabName = e.target.getAttribute('data-tab');
            document.querySelectorAll('.ai-content').forEach(box => box.style.display = 'none');
            document.getElementById(`tab-${tabName}`).style.display = 'block';
        };
    });

    const commentBox = document.getElementById('comment-box');
    if (commentBox) { 
        commentBox.addEventListener('input', function() { 
            if (state.currentNode) state.currentNode.comment = this.value; 
        }); 
    }

    const varBtnConfirm = document.getElementById('var-btn-confirm');
    if(varBtnConfirm) varBtnConfirm.onclick = () => closeModal('variation-modal');
    
    const btnNewCancel = document.getElementById('btn-new-cancel');
    if(btnNewCancel) btnNewCancel.onclick = () => closeModal('new-game-modal');
    
    const btnNewGame = document.getElementById('btn-new-game');
    if(btnNewGame) {
        btnNewGame.onclick = () => {
            if (state.isEditMode) { initGame(); return; }
            
            if (state.appMode === 'vsbot') {
                state.vsBotSetupOrigin = 'toolbar'; 
                document.getElementById('setup-bot-fen').value = START_FEN;
                document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                openModal('vsbot-setup-modal');
            } else {
                if (state.rootNode.children.length === 0) { initGame(); return; }
                const modal = document.getElementById('new-game-modal');
                if(!modal) return;
                modal.querySelector('.modal-header').innerText = "Chơi Ván Mới";
                modal.querySelector('.modal-body').innerHTML = `Bạn có chắc chắn muốn chơi ván mới không?<br>Những nước đi trước đó sẽ bị hủy.`;
                document.getElementById('btn-new-confirm').innerText = "Đồng Ý";
                openModal('new-game-modal');
            }
        };
    }
    
    const btnNewConfirm = document.getElementById('btn-new-confirm');
    if(btnNewConfirm) btnNewConfirm.onclick = () => { closeModal('new-game-modal'); initGame(); };

    const btnImportCancel = document.getElementById('btn-import-cancel');
    if(btnImportCancel) btnImportCancel.onclick = () => { document.getElementById('import-text').value = ''; closeModal('import-modal'); };
    
    const btnImportConfirm = document.getElementById('btn-import-confirm');
    if(btnImportConfirm) {
        btnImportConfirm.onclick = () => {
            const textData = document.getElementById('import-text').value.trim();
            if (textData) {
                // =============== XỬ LÝ RIÊNG CHO CHẾ ĐỘ ĐẤU VS BOT ===============
                if (state.appMode === 'vsbot') {
                    // Chặn tuyệt đối biên bản PGN, UBB, hoặc FEN có kèm move
                    if (textData.toLowerCase().includes("moves") || textData.includes("[") || textData.includes("DhtmlXQ")) {
                        showToast("❌ Chế độ Đấu Máy chỉ chấp nhận mã FEN hình cờ tĩnh, không nhận biên bản nước đi!");
                        return;
                    }
                    
                    let fenInput = textData;
                    // Bổ sung chuẩn cấu trúc FEN nếu người dùng chỉ dán mỗi đoạn tọa độ
                    if (!fenInput.includes(" w ") && !fenInput.includes(" b ")) {
                        fenInput += " w - - 0 1";
                    }

                    // Kiểm tra tính hợp lệ của FEN
                    const errorList = vschess.checkFen(fenInput);
                    if (errorList && errorList.length > 0) {
                        showToast(`❌ Mã FEN không hợp lệ!`);
                        return;
                    }

                    // FEN OK -> Đóng Panel Tải lên và Mở Panel Thiết Lập Bot
                    closeModal('import-modal');
                    document.getElementById('import-text').value = '';
                    
                    state.vsBotSetupOrigin = 'import_mode'; // Cờ theo dõi nguồn gốc mở setup
                    document.getElementById('setup-bot-fen').value = fenInput;
                    document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                    openModal('vsbot-setup-modal');
                    return;
                }

                // =============== XỬ LÝ CHO CHẾ ĐỘ PHÂN TÍCH BÌNH THƯỜNG ===============
                showLoading("Đang xử lý dữ liệu...");
                setTimeout(() => {
                    try {
                        const nodeData = vschess.dataToNode(textData);
                        const infoData = vschess.dataToInfo(textData);

                        if (nodeData && nodeData.fen) {
                            // SỬA Ở ĐÂY: Reset gameList và nạp ván mới dạng Object thô
                            state.gameList = [{ info: infoData, node: nodeData }];
                            loadGameFromList(0); // Nạp ván đầu tiên lên RAM
                            
                            closeModal('import-modal');
                            saveGameState(); // Auto-save xuống IndexedDB
                            showToast("✅ Tải dữ liệu thành công!");
                        } else { 
                            showToast("❌ Định dạng không hợp lệ hoặc không được hỗ trợ!"); 
                        }
                    } catch (error) { 
                        showToast("❌ Lỗi khi phân tích dữ liệu! Hãy xem Console (F12)."); 
                    }
                    hideLoading();
                }, 100); 
                document.getElementById('import-text').value = '';
            } else { 
                closeModal('import-modal'); 
            }
        };
    }

    const fileUpload = document.getElementById('file-upload');
    if(fileUpload) fileUpload.onchange = (e) => handleFileUpload(e.target.files[0]);
    
    const imageUpload = document.getElementById('image-upload');
    if(imageUpload) imageUpload.onchange = (e) => handleImageRecognition(e.target.files[0]);
    
    const cameraUpload = document.getElementById('camera-upload');
    if(cameraUpload) cameraUpload.onchange = (e) => handleImageRecognition(e.target.files[0]);

    const btnOpenInfoModal = document.getElementById('btn-open-info-modal');
    if(btnOpenInfoModal) btnOpenInfoModal.onclick = () => { closeModal('export-modal'); openModal('info-modal'); };
    
    const btnInfoCancel = document.getElementById('btn-info-cancel');
    if(btnInfoCancel) btnInfoCancel.onclick = () => { closeModal('info-modal'); openModal('export-modal'); };
    
    const btnInfoConfirm = document.getElementById('btn-info-confirm');
    if(btnInfoConfirm) {
        btnInfoConfirm.onclick = () => {
            for (let key in state.currentGameInfo) {
                const input = document.getElementById(`info-${key}`);
                if (input) state.currentGameInfo[key] = input.value;
            }
            let rawComment = state.rootNode.comment.split("-------------------\n")[1] || "";
            state.rootNode.comment = formatGameInfoString(state.currentGameInfo, rawComment);
            if(state.currentNode === state.rootNode && document.getElementById('comment-box')) {
                document.getElementById('comment-box').value = state.rootNode.comment;
            }
            closeModal('info-modal');
            openModal('export-modal');
            showToast("✅ Cập nhật thông tin thành công!");
        };
    }

    const btnEdit = document.getElementById('btn-edit');
    if(btnEdit) {
        btnEdit.onclick = () => {
            if (state.isEditMode) { finishEditing(btnEdit); return; }
            if (state.rootNode.children.length > 0) {
                document.getElementById('btn-edit-warning-cancel').onclick = () => { closeModal('edit-warning-modal'); };
                document.getElementById('btn-edit-warning-confirm').onclick = () => {
                    closeModal('edit-warning-modal');
                    turnOnEditMode(btnEdit); 
                };
                openModal('edit-warning-modal');
            } else {
                turnOnEditMode(btnEdit); 
            }
        };
    }

    document.querySelectorAll('.palette-turn-toggle').forEach(toggle => {
        toggle.onclick = () => {
            state.editTurn = (state.editTurn === 'w') ? 'b' : 'w';
            updateTurnToggleUI();
        };
    });

    const btnClearBoard = document.getElementById('btn-clear-board');
    if(btnClearBoard) {
        btnClearBoard.onclick = () => {
            for (let i=51; i<204; i++) {
                if (state.currentSituation[i] > 1) state.currentSituation[i] = 1;
            }
            state.currentSituation[199] = 21; 
            state.currentSituation[55] = 37;  
            renderBoardFull(state.currentSituation);
        };
    }

    document.querySelectorAll('.piece-palette img').forEach(img => {
        img.onclick = (e) => {
            if (state.selectedPalettePiece === e.target.dataset.piece) {
                state.selectedPalettePiece = null;
                e.target.classList.remove('piece-selected');
            } else {
                document.querySelectorAll('.piece-palette img').forEach(i => i.classList.remove('piece-selected'));
                e.target.classList.add('piece-selected');
                state.selectedPalettePiece = e.target.dataset.piece;
                state.selectedBoardPiece = null; 
                document.querySelectorAll('.chess-piece').forEach(p => p.classList.remove('piece-selected'));
            }
        };
    });
    
    const btnExportClose = document.getElementById('btn-export-close');
    if(btnExportClose) btnExportClose.onclick = () => closeModal('export-modal');

    const expFen = document.getElementById('exp-fen');
    if(expFen) expFen.onclick = () => copyToClipboard(state.currentNode.fen);

    const expMoveFen = document.getElementById('exp-move-fen');
    if(expMoveFen) {
        expMoveFen.onclick = () => {
            let { moves } = getMoveListAndComments();
            if (moves.length === 0) copyToClipboard(state.rootNode.fen);
            else copyToClipboard(state.rootNode.fen + " moves " + moves.join(" "));
        };
    }

    const expDhj = document.getElementById('exp-dhj');
    if(expDhj) {
        expDhj.onclick = () => {
            try {
                const vNode = getVschessNodeTree(state.rootNode);
                const data = vschess.nodeToData_DHJHtmlXQ(vNode, state.currentGameInfo, false);
                copyToClipboard(data);
            } catch (e) { showToast("❌ Lỗi khi xuất DHJHtmlXQ!"); }
        };
    }

    const expUbb = document.getElementById('exp-ubb');
    if(expUbb) {
        expUbb.onclick = () => {
            try {
                const vNode = getVschessNodeTree(state.rootNode);
                const data = vschess.nodeToData_DhtmlXQ(vNode, state.currentGameInfo, false);
                copyToClipboard(data);
            } catch (e) { showToast("❌ Lỗi khi xuất DhtmlXQ UBB!"); }
        };
    }

    function openSaveModal(type) {
        state.pendingDownloadType = type;
        let { moves } = getMoveListAndComments();
        document.getElementById('save-file-moves').innerText = `Tổng cộng ${moves.length} nước đi`;
        document.getElementById('save-file-name').value = "TuongKyViet";
        closeModal('export-modal');
        openModal('save-file-modal');
    }

    const btnSaveCancel = document.getElementById('btn-save-cancel');
    if(btnSaveCancel) {
        btnSaveCancel.onclick = () => {
            closeModal('save-file-modal');
            openModal('export-modal');
        };
    }

    const btnSaveConfirm = document.getElementById('btn-save-confirm');
    if(btnSaveConfirm) {
        btnSaveConfirm.onclick = () => {
            closeModal('save-file-modal'); 
            let filename = document.getElementById('save-file-name').value.trim() || "TuongKyViet";
            filename += "_" + getFormattedDate();
            
            try {
                let { moves, comments } = getMoveListAndComments();
                let vNode = getVschessNodeTree(state.rootNode);

                if (state.pendingDownloadType === 'pgn-wxf') {
                    let wxfMoves = vschess.nodeList2moveList(moves, state.rootNode.fen, "wxf", vschess.defaultOptions, false);
                    wxfMoves.shift(); 
                    const pgnData = vschess.moveListToData_PGN(wxfMoves, state.rootNode.fen, comments, state.currentGameInfo, state.currentGameInfo.result);
                    downloadFile(filename + ".pgn", pgnData);
                } else if (state.pendingDownloadType === 'pgn-iccs') {
                    let iccsDashMoves = moves.map(m => m.substring(0,2) + "-" + m.substring(2,4));
                    const pgnData = vschess.moveListToData_PGN(iccsDashMoves, state.rootNode.fen, comments, state.currentGameInfo, state.currentGameInfo.result);
                    downloadFile(filename + ".pgn", pgnData);
                } else if (state.pendingDownloadType === 'xqf') {
                    const binArray = vschess.nodeToBinary_XQF(vNode, state.currentGameInfo, false);
                    downloadFile(filename + ".xqf", binArray, true);
                } else if (state.pendingDownloadType === 'cbr') {
                    const binArray = vschess.nodeToBinary_CBR(vNode, state.currentGameInfo, false);
                    downloadFile(filename + ".cbr", binArray, true);
                } else if (state.pendingDownloadType === 'che') {
                    const cheData = vschess.moveListToData_QQ(moves, false);
                    downloadFile(filename + ".che", cheData);
                }
            } catch(e) { showToast("❌ Có lỗi xảy ra khi xuất file!"); }
        };
    }

    const expPgnWxf = document.getElementById('exp-pgn-wxf');
    if(expPgnWxf) expPgnWxf.onclick = () => openSaveModal('pgn-wxf');
    
    const expPgnIccs = document.getElementById('exp-pgn-iccs');
    if(expPgnIccs) expPgnIccs.onclick = () => openSaveModal('pgn-iccs');
    
    const expXqf = document.getElementById('exp-xqf');
    if(expXqf) expXqf.onclick = () => openSaveModal('xqf');
    
    const expCbr = document.getElementById('exp-cbr');
    if(expCbr) expCbr.onclick = () => openSaveModal('cbr');
    
    const expChe = document.getElementById('exp-che');
    if(expChe) expChe.onclick = () => openSaveModal('che');
    
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
    let initialModeId = `menu-${state.appMode}`;
    if (state.appMode === 'vsbot') initialModeId = 'menu-bot';
    
    if(document.getElementById(initialModeId)) {
        document.getElementById(initialModeId).classList.add('menu-item-active');
    }
}