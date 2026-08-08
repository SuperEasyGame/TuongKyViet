// js/events.js
import { state, storage } from './state.js';
import { getWorkspace , saveWorkspace, deleteWorkspace } from './db.js';
import { toggleAutoPlay, forceStopAIPlayers, jumpToNode, initGame, loadGameFromList } from './game.js';
import { triggerEngineEvaluation, applyEngineSettings, getDeviceTier } from './engine.js';
import { openModal, closeModal, updateTurnToggleUI, showLoading, hideLoading, showToast, renderLibraryList, confirmDeleteLibraryItem, renderMemorizeList } from './ui.js';
import { finishEditing, turnOnEditMode } from './editor.js';
import { handleImageRecognition, handleFileUpload, getMoveListAndComments, copyToClipboard, getVschessNodeTree, downloadFile, getFormattedDate, formatGameInfoString, saveGameState } from './io.js';
import { renderBoardFull, drawBestMoveArrow, clearArrow } from './board.js';
import { START_FEN, VschessErrorDict } from './config.js';

let pendingDeletePuzKey = "";

function makeRandomString(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

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
    if (state.appMode === 'memorize' || state.appMode === 'puzzle') {
        state.gameList = [];
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

        if (state.appMode === 'vsbot' || state.appMode === 'memorize'|| state.appMode === 'puzzle') {
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
                if (state.appMode === 'memorize') {
                    module.forceStopAIPlayers();
                    if (state.memorizeSettings.side === 'both') {
                        if (state.currentNode.parent) module.jumpToNode(state.currentNode.parent);
                    } else {
                        if (state.currentNode.parent && state.currentNode.parent.parent) {
                            module.jumpToNode(state.currentNode.parent.parent);
                        }
                    }
                } else if (state.appMode === 'puzzle') {
                    // GIẢI BÀI TẬP: Lùi 2 nước (Xóa lịch sử)
                    module.undoVsBot();
                } else {
                    module.undoVsBot();
                }
            });
        };
    }

    const btnHint = document.getElementById('btn-hint');
    if (btnHint) {
        btnHint.onclick = () => {
            if (btnHint.classList.contains('disabled') || !state.engineModule) return;
            
            // XỬ LÝ GỢI Ý CHO GIẢI BÀI TẬP (AI TỰ ĐI GIÚP PLAYER)
            if (state.appMode === 'puzzle') {
                showToast(`💡 Máy đang suy nghĩ nước giải...`);
                btnHint.classList.add('disabled');
                
                const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
                // Tạm thời trao quyền cho Máy cầm quân của người chơi
                if (isRedTurn) state.aiPlaysRed = true; else state.aiPlaysBlack = true;
                
                // Kích hoạt Engine. Vì cờ "aiPlays..." đã bật nên Engine sẽ tự động
                // sử dụng cấu hình Phân Tích (Depth, MoveTime) để tìm nước cờ và TỰ ĐI.
                import('./engine.js').then(module => {
                    module.triggerEngineEvaluation(); 
                });
                
                // Việc thu hồi quyền AI sẽ do hàm executeMove() trong game.js đảm nhận
                // sau khi quân cờ đã được di chuyển xong!
                return;
            }
            
            const styleName = state.vsBotSettings.botStyle === 'human' ? 'Giống người' : 'Tiêu chuẩn';
            showToast(`💡 AI đang dùng Level 10 (${styleName}) để nghĩ nước đi...`);
            
            btnHint.classList.add('disabled');
            
            import('./engine.js').then(module => {
                module.triggerHintEvaluation();
            });
        };
    }

    function checkBlockedNav(e) {
        if (state.appMode === 'vsbot' || state.appMode === 'memorize'|| state.appMode === 'puzzle') {
            e.preventDefault(); e.stopPropagation();
            showToast("Bạn không thể tiến/lùi cờ trong chế độ này!");
            return true;
        }
        return false;
    }

    const btnAutoPlay = document.getElementById('btn-auto-play');
    if(btnAutoPlay) btnAutoPlay.onclick = (e) => { if(checkBlockedNav(e)) return; toggleAutoPlay(); };
    
    const btnStart = document.getElementById('btn-start');
    if(btnStart) btnStart.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode !== state.rootNode) { forceStopAIPlayers(); jumpToNode(state.rootNode); triggerEngineEvaluation(); }
    };
    
    const btnPrev = document.getElementById('btn-prev');
    if(btnPrev) btnPrev.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode.parent) { forceStopAIPlayers(); jumpToNode(state.currentNode.parent); }
    };
    
    const btnNext = document.getElementById('btn-next');
    if(btnNext) btnNext.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode.children.length) { forceStopAIPlayers(); jumpToNode(state.currentNode.children[state.currentNode.mainLineIndex]); }
    };
    
    const btnEnd = document.getElementById('btn-end');
    if(btnEnd) btnEnd.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
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

    // ====== Giải Bài Tập ======
    const menuPuzzle = document.getElementById('menu-puzzle');
    if (menuPuzzle) {
        menuPuzzle.onclick = () => { 
            closeModal('main-menu-modal'); 
            if (state.appMode === 'puzzle') return; 
            
            state.puzzleOpenedFromMenu = true; 
            
            openModal('puzzle-modal');
            
            // KIỂM TRA: Nếu đang xem FEN thì refresh (Có setTimeout), nếu chưa thì load Folder
            if (state.isViewingPuzzleFens) {
                setTimeout(() => refreshPuzzleListUI(), 100);
            } else {
                state.puzzleHistory = [];
                state.currentPuzzleFolder = { path: 'data', name: '' };
                loadPuzzleManifest(state.currentPuzzleFolder.path, state.currentPuzzleFolder.name);
            }
        };
    }

    const btnPuzzleClose = document.getElementById('btn-puzzle-close');
    if (btnPuzzleClose) btnPuzzleClose.onclick = () => {
        closeModal('puzzle-modal');
        if (state.puzzleOpenedFromMenu) {
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
            let currentModeId = `menu-${state.appMode}`;
            if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
            const activeBtn = document.getElementById(currentModeId);
            if(activeBtn) activeBtn.classList.add('menu-item-active');
            openModal('main-menu-modal');
        }
    };

    const btnPuzzleBack = document.getElementById('btn-puzzle-back');
    if (btnPuzzleBack) btnPuzzleBack.onclick = () => {
        const subtitle = document.getElementById('puzzle-modal-subtitle');

        // Trường hợp 1: Đang xem danh sách FEN -> Quay lại danh sách File
        if (state.isViewingPuzzleFens) {
            state.isViewingPuzzleFens = false;
            document.getElementById('puzzle-fen-view').style.display = 'none';
            document.getElementById('puzzle-manifest-view').style.display = 'flex';
            
            // Phục hồi lại tên thư mục cha
            if (state.currentPuzzleFolder.name) {
                subtitle.innerText = state.currentPuzzleFolder.name;
                subtitle.style.display = 'block';
            } else {
                subtitle.style.display = 'none'; // Ẩn nếu ở thư mục gốc
            }
            
            if (state.puzzleHistory.length === 0) btnPuzzleBack.style.display = 'none';
        } 
        // Trường hợp 2: Đang ở thư mục con -> Quay lại thư mục cha
        else if (state.puzzleHistory.length > 0) {
            const prevFolder = state.puzzleHistory.pop();
            state.currentPuzzleFolder = prevFolder; // Cập nhật thư mục hiện tại
            loadPuzzleManifest(prevFolder.path, prevFolder.name, true);
        }
    };
    // Sự kiện Nút "Danh sách" trong New Game Modal
    const btnNewList = document.getElementById('btn-new-list');
    if (btnNewList) {
        btnNewList.onclick = () => {
            closeModal('new-game-modal');
            state.puzzleOpenedFromMenu = false;
            
            openModal('puzzle-modal');
            
            // THÊM SETTIMEOUT ĐỂ CHỜ MODAL MỞ XONG MỚI REFRESH UI
            if (state.isViewingPuzzleFens) {
                setTimeout(() => refreshPuzzleListUI(), 100);
            }
        };
    }

    // --- SỰ KIỆN CỦA MODAL KẾT QUẢ BÀI TẬP ---
    const btnPuzResList = document.getElementById('btn-puz-res-list');
    if (btnPuzResList) {
        btnPuzResList.onclick = () => {
            closeModal('puzzle-result-modal');
            state.puzzleOpenedFromMenu = false;
            
            openModal('puzzle-modal');
            
            // THÊM SETTIMEOUT ĐỂ CHỜ MODAL MỞ XONG MỚI REFRESH UI
            if (state.isViewingPuzzleFens) {
                setTimeout(() => refreshPuzzleListUI(), 100);
            }
        };
    }

    const btnPuzResRetry = document.getElementById('btn-puz-res-retry');
    if (btnPuzResRetry) {
        btnPuzResRetry.onclick = () => {
            closeModal('puzzle-result-modal');
            import('./game.js').then(m => {
                m.forceStopAIPlayers();
                state.rootNode.children = [];
                state.rootNode.mainLineIndex = 0;
                m.instantJumpToNode(state.rootNode);
                
                const isRedFirst = state.rootNode.fen.split(" ")[1] === "w";
                state.aiPlaysRed = !isRedFirst;
                state.aiPlaysBlack = isRedFirst;
                m.updateVsBotToolButtons();
            });
        };
    }

    const btnPuzResNext = document.getElementById('btn-puz-res-next');
    if (btnPuzResNext) {
        btnPuzResNext.onclick = () => {
            closeModal('puzzle-result-modal');
            if (state.currentPuzzleIndex < state.puzzleFens.length - 1) {
                state.currentPuzzleIndex++;
                saveWorkspace('puz_prog_' + state.currentPuzzleSolvedKey, state.currentPuzzleIndex);
                const nextFen = state.puzzleFens[state.currentPuzzleIndex];
                switchMode('puzzle', nextFen);
                showToast(`Đã mở bài số ${state.currentPuzzleIndex + 1}!`);
            }
        };
    }
    // =========================
    
    // ====== Luyện Nhớ Ván ======
    const menuOpening = document.getElementById('menu-memorize');
    if(menuOpening) {
        menuOpening.onclick = () => { 
            if (state.appMode === 'memorize') {
                closeModal('main-menu-modal');
                return;
            }
            closeModal('main-menu-modal');
            state.memorizeOpenedFromMenu = true; 
            openModal('memorize-modal');
            renderMemorizeList();
        };
    }
    const btnMemoClose = document.getElementById('btn-memo-close');
    if (btnMemoClose) btnMemoClose.onclick = () => {
        closeModal('memorize-modal');
        
        if (state.memorizeOpenedFromMenu) {
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
            let currentModeId = `menu-${state.appMode}`;
            if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
            
            const activeBtn = document.getElementById(currentModeId);
            if(activeBtn) activeBtn.classList.add('menu-item-active');

            openModal('main-menu-modal');
        }
    };
    const memoFileUpload = document.getElementById('memorize-file-upload');
    if (memoFileUpload) {
        memoFileUpload.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const extension = file.name.split('.').pop().toLowerCase();
            const validBinary = ['xqf', 'cbr', 'ccm'];
            const validText = ['pgn', 'pfc', 'che'];
            
            const reader = new FileReader();
            showLoading(`Đang đọc tệp ${file.name}...`);

            if (validBinary.includes(extension)) {
                reader.onload = (ev) => {
                    try {
                        const buffer = new Uint8Array(ev.target.result);
                        let nodeData, infoData;
                        if (extension === 'xqf') { nodeData = vschess.binaryToNode_XQF(buffer); infoData = vschess.binaryToInfo_XQF(buffer); }
                        else if (extension === 'cbr') { nodeData = vschess.binaryToNode_CBR(buffer); infoData = vschess.binaryToInfo_CBR(buffer); }
                        else if (extension === 'ccm') { nodeData = vschess.binaryToNode_CCM(buffer); }
                        
                        if (nodeData && nodeData.fen) {
                            state.pendingMemorizeData = { node: nodeData, info: infoData || {} };
                            closeModal('memorize-modal');
                            openModal('memorize-setup-modal');
                        } else showToast("❌ Lỗi đọc File!");
                    } catch (err) { showToast("❌ Có lỗi xảy ra!"); }
                    hideLoading();
                };
                reader.readAsArrayBuffer(file);
            } 
            else if (validText.includes(extension)) {
                reader.onload = (ev) => {
                    try {
                        const textData = ev.target.result;
                        let nodeData, infoData;
                        if (extension === 'pgn') { nodeData = vschess.dataToNode_PGN(textData); infoData = vschess.dataToInfo_PGN(textData); }
                        else if (extension === 'pfc') { nodeData = vschess.dataToNode_PFC(textData); infoData = vschess.dataToInfo_PFC(textData); }
                        else if (extension === 'che') { nodeData = vschess.dataToNode_QQNew(textData); }
                        
                        if (nodeData && nodeData.fen) {
                            state.pendingMemorizeData = { node: nodeData, info: infoData || {} };
                            closeModal('memorize-modal');
                            openModal('memorize-setup-modal');
                        } else showToast("❌ Lỗi đọc File!");
                    } catch (err) { showToast("❌ Có lỗi xảy ra!"); }
                    hideLoading();
                };
                reader.readAsText(file);
            } else {
                hideLoading();
                showToast(`❌ Định dạng .${extension} không được hỗ trợ!`);
            }
            // Reset input để chọn lại file cũ nếu cần
            e.target.value = '';
        };
    }

    const memoSetupBlind = document.getElementById('memo-setup-blind');
    const memoSetupPath = document.getElementById('memo-setup-path');
    const memoSetupMethod = document.getElementById('memo-setup-method');
    function syncMemoUI() {
        if (!memoSetupBlind || !memoSetupPath || !memoSetupMethod) return;

        // 1. Reset về trạng thái bình thường (mở khóa)
        memoSetupPath.disabled = false;
        memoSetupPath.style.opacity = '1';
        memoSetupBlind.disabled = false;
        memoSetupBlind.parentElement.style.opacity = '1';
        memoSetupMethod.disabled = false;
        memoSetupMethod.style.opacity = '1';

        // 2. Xét theo ưu tiên từ trên xuống
        if (memoSetupBlind.checked) {
            // Cờ mù BẬT -> Ép: Luyện toàn bộ + Nhánh ngẫu nhiên
            memoSetupMethod.value = 'full';
            memoSetupMethod.disabled = true;
            memoSetupMethod.style.opacity = '0.5';

            memoSetupPath.value = 'random';
            memoSetupPath.disabled = true;
            memoSetupPath.style.opacity = '0.5';
        } 
        else if (memoSetupMethod.value === 'segment') {
            // Luyện đoạn ngắn BẬT -> Ép: Nhánh chính + Tắt Cờ mù
            memoSetupPath.value = 'main';
            memoSetupPath.disabled = true;
            memoSetupPath.style.opacity = '0.5';

            memoSetupBlind.checked = false;
            memoSetupBlind.disabled = true;
            memoSetupBlind.parentElement.style.opacity = '0.5';
        }
    }

    if (memoSetupBlind) memoSetupBlind.onchange = syncMemoUI;
    if (memoSetupPath) memoSetupPath.onchange = syncMemoUI;
    if (memoSetupMethod) memoSetupMethod.onchange = syncMemoUI;

    const btnMemoSetupCancel = document.getElementById('btn-memo-setup-cancel');
    if (btnMemoSetupCancel) {
        btnMemoSetupCancel.onclick = () => {
            state.pendingMemorizeData = null; // Hủy data
            closeModal('memorize-setup-modal');
            openModal('memorize-modal');
        };
    }

    const btnMemoSetupConfirm = document.getElementById('btn-memo-setup-confirm');
    if (btnMemoSetupConfirm) {
        btnMemoSetupConfirm.onclick = () => {
            if (!state.pendingMemorizeData) return;
            
            // 1. Lưu Setting
            state.memorizeSettings.side = document.getElementById('memo-setup-side').value;
            state.memorizeSettings.method = document.getElementById('memo-setup-method').value;
            state.memorizeSettings.path = document.getElementById('memo-setup-path').value;
            state.memorizeSettings.isBlind = document.getElementById('memo-setup-blind').checked;

            state.memoMistakesRed = 0;
            state.memoMistakesBlack = 0;
            
            // 2. Chuyển UI sang AppMode mới
            state.appMode = 'memorize';
            state.appSettings.appMode = 'memorize';
            
            state.isPeeking = !state.memorizeSettings.isBlind; 
            document.body.classList.remove('mode-vsbot', 'mode-blind', 'mode-memorize');
            document.body.classList.add('mode-memorize');
            if (state.memorizeSettings.isBlind) {
                document.body.classList.add('mode-blind');
            }

            const titleHeader = document.getElementById('tab-title');
            if (titleHeader) {
                titleHeader.innerHTML = `
                    <strong style="font-size: 17px; color: #333; display: block; width: 100%;">LUYỆN NHỚ VÁN</strong>
                    <div id="blind-turn-indicator" style="display:block; margin-top: 15px; font-size: 16px; font-weight: bold; color: #555;">
                        Lượt đi: <span id="blind-turn-text">Bên Đỏ</span>
                    </div>
                    <div id="memo-mistakes-indicator" style="display: flex; justify-content: center; gap: 15px; margin-top: 5px; font-size: 13px; font-weight: bold;">
                        <span style="color: #d32f2f;">Đỏ đi sai: <span id="memo-err-red">0</span></span>
                        <span style="color: #000;">Đen đi sai: <span id="memo-err-black">0</span></span>
                    </div>
                    <div id="memo-variation-container" style="display: none; margin-top: 15px; width: 100%; flex-direction: column; gap: 8px;">
                        <div style="font-size: 13px; color: #d32f2f; margin-bottom: 5px;">Mời bạn chọn biến:</div>
                    </div>
                `;
            }

            // 3. XỬ LÝ DỮ LIỆU & CẮT ĐOẠN NGẮN
            import('./game.js').then(m => {
                m.forceStopAIPlayers();

                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                else { state.aiPlaysRed = false; state.aiPlaysBlack = false; }

                state.gameList = [{ info: state.pendingMemorizeData.info, node: state.pendingMemorizeData.node }];
                m.loadGameFromList(0); // Hàm này sẽ kết nối cây Node trên RAM
                
                // === XỬ LÝ CẮT ĐOẠN THEO YÊU CẦU ===
                let pathNodes = [];
                let curr = state.rootNode;
                // Đi theo nhánh chính (index 0) để lấy danh sách các Node
                while(curr) {
                    pathNodes.push(curr);
                    if(curr.children.length > 0) curr = curr.children[0];
                    else break;
                }
                
                let totalMoves = pathNodes.length - 1; 

                if (state.memorizeSettings.method === 'segment' && totalMoves > 6) {
                    // Cắt random
                    let maxStart = totalMoves - 6;
                    let startIdx = Math.floor(Math.random() * (maxStart + 1));
                    let maxLen = totalMoves - startIdx;
                    let len = Math.floor(Math.random() * (maxLen - 6 + 1)) + 6;
                    let endIdx = startIdx + len;

                    state.memorizeSettings.startNodeId = pathNodes[startIdx].id;
                    state.memorizeSettings.endNodeId = pathNodes[endIdx].id;
                    
                    // Nhảy ngay tới đoạn bắt đầu
                    m.instantJumpToNode(pathNodes[startIdx]);
                } else {
                    // Luyện toàn bộ
                    state.memorizeSettings.startNodeId = pathNodes[0].id;
                    state.memorizeSettings.endNodeId = pathNodes[pathNodes.length - 1].id;
                    m.instantJumpToNode(pathNodes[0]);
                }

                m.applyAutoBoardFlip();
                
                // Trễ nhẹ để UI Canvas xử lý kịp trước khi báo BOT đánh
                setTimeout(() => m.triggerMemorizeBot(), 300);
            });

            closeModal('memorize-setup-modal');
            showToast("✅ Bắt đầu Luyện Nhớ Ván!");
        };
    }
    const btnMemoRetry = document.getElementById('btn-memo-retry');
    if (btnMemoRetry) {
        btnMemoRetry.onclick = () => {
            closeModal('memo-gameover-modal');
            state.memoMistakesRed = 0;
            state.memoMistakesBlack = 0;
            
            import('./game.js').then(m => {
                m.forceStopAIPlayers();
                
                // Hàm tìm Node xuất phát trong Cây Node
                function findNodeById(node, id) {
                    if (node.id === id) return node;
                    for(let c of node.children) {
                        let found = findNodeById(c, id);
                        if (found) return found;
                    }
                    return null;
                }
                
                let startNode = findNodeById(state.rootNode, state.memorizeSettings.startNodeId) || state.rootNode;
                m.instantJumpToNode(startNode); 
                
                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                else { state.aiPlaysRed = false; state.aiPlaysBlack = false; }
                
                m.updateBlindTurnUI();
                setTimeout(() => m.triggerMemorizeBot(), 300);
            });
        };
    }
    const btnMemoNew = document.getElementById('btn-memo-new');
    if (btnMemoNew) {
        btnMemoNew.onclick = () => {
            closeModal('memo-gameover-modal');

            state.memoMistakesRed = 0;
            state.memoMistakesBlack = 0;

            state.memorizeOpenedFromMenu = false;
            openModal('memorize-modal');
            renderMemorizeList(); // Mở lại danh sách thư viện
        };
    }
    //=============================

     // ====== Thư Viện ======
    const menuLibrary = document.getElementById('menu-library');
    if (menuLibrary) {
        menuLibrary.onclick = () => {
            closeModal('main-menu-modal');
            openModal('library-modal');
            renderLibraryList();
        };
    }
    const btnLibClose = document.getElementById('btn-lib-close');
    if (btnLibClose) btnLibClose.onclick = () => {
        closeModal('library-modal');
        openModal('main-menu-modal');
    };
    const btnDelLibCancel = document.getElementById('btn-del-lib-cancel');
    if (btnDelLibCancel) btnDelLibCancel.onclick = () => closeModal('delete-lib-modal');

    const btnDelLibConfirm = document.getElementById('btn-del-lib-confirm');
    if (btnDelLibConfirm) btnDelLibConfirm.onclick = () => confirmDeleteLibraryItem();
    //==============================
    
    // ====== Setting ======
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

            if (state.appMode === 'memorize') {
                state.memorizeOpenedFromMenu = false;
                openModal('memorize-modal');
                renderMemorizeList();
                return;
            }
            
            if (state.appMode === 'vsbot') {
                state.vsBotSetupOrigin = 'toolbar'; 
                document.getElementById('setup-bot-fen').value = START_FEN;
                document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                openModal('vsbot-setup-modal');
            } else if (state.appMode === 'puzzle') {
                // GIẢI BÀI TẬP: Hỏi chơi lại từ đầu
                const modal = document.getElementById('new-game-modal');
                if(!modal) return;
                modal.querySelector('.modal-header').innerText = "Chơi Lại Bài Tập";
                modal.querySelector('.modal-body').innerHTML = `Bạn có muốn giải lại từ đầu không?<br>Lịch sử nước đi sẽ bị xóa.`;
                document.getElementById('btn-new-confirm').innerText = "Đồng Ý";
                const btnList = document.getElementById('btn-new-list');
                if(btnList) btnList.style.display = 'block';
                openModal('new-game-modal');
            } else {
                const btnList = document.getElementById('btn-new-list');
                if(btnList) btnList.style.display = 'none';
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
    if(btnNewConfirm) btnNewConfirm.onclick = () => { 
        closeModal('new-game-modal'); 
        
        if (state.appMode === 'puzzle') {
            import('./game.js').then(m => {
                m.forceStopAIPlayers();
                // Xóa toàn bộ nhánh con (lịch sử) của Root
                state.rootNode.children = [];
                state.rootNode.mainLineIndex = 0;
                m.instantJumpToNode(state.rootNode); // Nhảy về node gốc
                
                // Khôi phục lại quyền AI
                const isRedFirst = state.rootNode.fen.split(" ")[1] === "w";
                state.aiPlaysRed = !isRedFirst;
                state.aiPlaysBlack = isRedFirst;
                m.updateVsBotToolButtons();
            });
        } else {
            initGame(); 
        }
    };

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
        btnSaveConfirm.onclick = async () => {
            closeModal('save-file-modal'); 

            const rawFileName = document.getElementById('save-file-name').value.trim() || "TuongKyViet";
            const downloadFileName = rawFileName + "_" + getFormattedDate();
            
            try {
                let { moves, comments } = getMoveListAndComments();
                let vNode = getVschessNodeTree(state.rootNode);
                
                if (state.pendingDownloadType === 'library') {
                    showLoading("Đang lưu vào thư viện...");
                    
                    // 1. Chuyển đổi Ván cờ thành định dạng chuỗi Text (DhtmlXQ UBB)
                    const gameDataText = vschess.nodeToData_DhtmlXQ(vNode, state.currentGameInfo, false);
                    
                    const idKey = 'lib_' + Date.now(); // 2. Tạo Key ID độc nhất
                    
                    await saveWorkspace(idKey, gameDataText); // 3. Lưu nội dung ván cờ vào IndexedDB với Key ID vừa tạo
                    
                    // 4. Lấy danh sách thư viện hiện tại, thêm File mới vào, và lưu lại danh sách
                    let libraryList = await getWorkspace('library_workspace') || [];
                    libraryList.push({ id_key: idKey, file_name: rawFileName });
                    await saveWorkspace('library_workspace', libraryList);
                    
                    hideLoading();
                    showToast(`✅ Đã lưu "${rawFileName}" vào Thư viện thành công!`);
                }
                else if (state.pendingDownloadType === 'pgn-wxf') {
                    let wxfMoves = vschess.nodeList2moveList(moves, state.rootNode.fen, "wxf", vschess.defaultOptions, false);
                    wxfMoves.shift(); 
                    const pgnData = vschess.moveListToData_PGN(wxfMoves, state.rootNode.fen, comments, state.currentGameInfo, state.currentGameInfo.result);
                    downloadFile(downloadFileName + ".pgn", pgnData);
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
            } catch(e) { hideLoading(); showToast("❌ Có lỗi xảy ra khi xuất file!"); }
        };
    }

    const expLibrary = document.getElementById('exp-library');
    if(expLibrary) expLibrary.onclick = () => openSaveModal('library');

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

    // === LOGIC XỬ LÝ MANIFEST VÀ LOCAL DB ===
    async function loadPuzzleManifest(folderPath, folderName = '', isBack = false) {
        showLoading("Đang tải danh sách...");
        state.isViewingPuzzleFens = false;
        
        // Cập nhật UI về View 1
        document.getElementById('puzzle-fen-view').style.display = 'none';
        const container = document.getElementById('puzzle-manifest-view');
        container.style.display = 'flex';
        
        const subtitle = document.getElementById('puzzle-modal-subtitle');
        if (folderName) {
            subtitle.innerText = folderName;
            subtitle.style.display = 'block';
        } else {
            subtitle.style.display = 'none';
        }

        const btnBack = document.getElementById('btn-puzzle-back');
        if (state.puzzleHistory.length > 0) btnBack.style.display = 'block';
        else btnBack.style.display = 'none';

        container.innerHTML = ''; 

        // ==========================================
        // LUỒNG 1: NẾU ĐANG VÀO "BÀI TẬP CỦA TÔI" (Dùng IndexedDB)
        // ==========================================
        if (folderPath === 'my_puzzles') {
            try {
                // 1. Render nút Tải lên JSON
                const btnUpload = document.createElement('button');
                btnUpload.className = 'import-btn btn-blue';
                btnUpload.style.cssText = 'width: 100%; margin-bottom: 5px; flex-shrink: 0;';
                btnUpload.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Tải File JSON Bài Tập`;
                btnUpload.onclick = () => document.getElementById('puzzle-file-upload').click();
                container.appendChild(btnUpload);

                // 2. Fetch danh sách từ IndexedDB
                let myPuzData = await getWorkspace('my_puzzle');
                if (!myPuzData || !myPuzData.files || myPuzData.files.length === 0) {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.style.cssText = 'text-align:center; color:#888; margin-top:20px; font-size:14px;';
                    emptyDiv.innerText = 'Chưa có bài tập nào. Hãy tải lên file JSON!';
                    container.appendChild(emptyDiv);
                } else {
                    // 3. Render danh sách File kèm nút Xóa
                    myPuzData.files.forEach(file => {
                        const item = document.createElement('div');
                        item.className = 'lib-item'; // Dùng chung class với Thư viện
                        item.style.cssText = 'border-radius: 8px; border: 1px solid #eee; margin-bottom: 2px;';
                        item.innerHTML = `
                            <span class="puzzle-icon" style="margin-right:8px;">📄</span>
                            <span class="lib-title">${file.file_name}</span>
                            <button class="lib-btn-del" title="Xóa file này">
                                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            </button>
                        `;

                        // Click vào vùng text -> Đọc file từ DB
                        item.onclick = (e) => {
                            if(e.target.closest('.lib-btn-del')) return; 
                            loadPuzzleFileData(file.file_name, file.file_key, true); // true = Đọc từ Local DB
                        };

                        // Click vào nút Xóa
                        item.querySelector('.lib-btn-del').onclick = (e) => {
                            e.stopPropagation();
                            pendingDeletePuzKey = file.file_key;
                            document.getElementById('delete-puz-name').innerText = file.file_name;
                            openModal('delete-puz-modal');
                        };

                        container.appendChild(item);
                    });
                }
            } catch (err) { showToast("❌ Lỗi khi đọc dữ liệu Bài Tập Của Tôi!"); }
            hideLoading();
            return; // KẾT THÚC LUỒNG 1 TẠI ĐÂY
        }

        // ==========================================
        // LUỒNG 2: ĐỌC TỪ MANIFEST JSON TRÊN MÁY CHỦ
        // ==========================================
        try {
            let isDevUnlocked = false;
            if (folderPath === 'data') {
                const devKey = await getWorkspace('dev_puzzle_unlocked');
                if (devKey) isDevUnlocked = true;
            }

            const response = await fetch(`${folderPath}/manifest.json?v=${new Date().getTime()}`);
            if (!response.ok) throw new Error("Không tìm thấy file manifest");
            
            const data = await response.json();

            // Chèn "Bài Tập Của Tôi" nếu đã Unlock
            if (folderPath === 'data' && isDevUnlocked) {
                if (!data.folders) data.folders = [];
                data.folders.unshift({
                    folder_name: "Bài Tập Của Tôi",
                    folder_path: "my_puzzles" // Trỏ tới luồng 1
                });
            }

            // Render Thư mục
            if (data.folders && data.folders.length > 0) {
                data.folders.forEach(folder => {
                    const btn = document.createElement('button');
                    btn.className = 'puzzle-item';
                    btn.innerHTML = `<span class="puzzle-icon">📁</span><span class="puzzle-name">${folder.folder_name}</span>`;
                    btn.onclick = () => {
                        state.puzzleHistory.push({ ...state.currentPuzzleFolder }); 
                        state.currentPuzzleFolder = { path: folder.folder_path, name: folder.folder_name };
                        loadPuzzleManifest(state.currentPuzzleFolder.path, state.currentPuzzleFolder.name); 
                    };
                    container.appendChild(btn);
                });
            }

            // Render File
            if (data.files && data.files.length > 0) {
                data.files.forEach(file => {
                    const btn = document.createElement('button');
                    btn.className = 'puzzle-item';
                    btn.innerHTML = `<span class="puzzle-icon">📄</span><span class="puzzle-name">${file.file_name}</span>`;
                    btn.onclick = () => {
                        loadPuzzleFileData(file.file_name, file.file_path, false); // false = Remote
                    };
                    container.appendChild(btn);
                });
            }

            // Vùng bấm tàng hình để Unlock
            if (folderPath === 'data' && !isDevUnlocked) {
                const hiddenDevArea = document.createElement('div');
                hiddenDevArea.style.flex = "1"; 
                hiddenDevArea.style.background = "transparent";
                hiddenDevArea.style.minHeight = "60px"; 
                
                let clickCount = 0;
                let clickTimer = null;

                hiddenDevArea.onclick = () => {
                    clickCount++;
                    clearTimeout(clickTimer);
                    if (clickCount >= 5) {
                        Promise.all([
                            saveWorkspace('dev_puzzle_unlocked', { unlock: true }),
                            getWorkspace('my_puzzle').then(res => {
                                if (!res) return saveWorkspace('my_puzzle', { files: [] });
                            })
                        ]).then(() => {
                            showToast("🔓 Đã mở khóa Bài Tập Của Tôi!");
                            loadPuzzleManifest('data', ''); 
                        });
                        clickCount = 0;
                    } else {
                        clickTimer = setTimeout(() => { clickCount = 0; }, 1000);
                    }
                };
                container.appendChild(hiddenDevArea);
            }

        } catch (err) {
            showToast("❌ Không thể tải danh sách (Kiểm tra lại mạng)!");
            if (!isBack && state.puzzleHistory.length > 0) {
                state.currentPuzzleFolder = state.puzzleHistory.pop(); 
            }
        }
        hideLoading();
    }


    // === LOGIC UPLOAD VÀ XÓA FILE (Dành cho Bài Tập Của Tôi) ===
    function handlePuzzleUpload(file) {
        if (!file) return;
        const reader = new FileReader();
        showLoading("Đang kiểm tra file JSON...");

        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                // Kiểm tra sự tồn tại của các key và cấu trúc chuẩn xác
                const keys = Object.keys(data);
                const requiredKeys = ['max_moves', 'key', 'fens'];
                
                // Trả về lỗi nếu thừa, thiếu, hoặc sai định dạng array
                const isStrictlyValid = keys.length === 3 && 
                                        requiredKeys.every(k => keys.includes(k)) && 
                                        Array.isArray(data.fens);

                if (!isStrictlyValid) {
                    throw new Error("Cấu trúc JSON không hợp lệ. Chỉ chấp nhận các key: max_moves, key, fens.");
                }

                // 1. Tạo Key mới lưu vào DB
                const timeSuffix = getFormattedDate();
                const newFileKey = 'puz_' + Math.floor(Math.random()*1000) + '_' + timeSuffix;
                
                // 2. Lưu file thô vào DB
                await saveWorkspace(newFileKey, data);
                
                // 3. Cập nhật danh sách my_puzzle
                let myPuz = await getWorkspace('my_puzzle');
                if (!myPuz) myPuz = { files: [] };
                
                const cleanFileName = file.name.replace('.json', '');
                myPuz.files.push({ file_name: cleanFileName, file_key: newFileKey });
                await saveWorkspace('my_puzzle', myPuz);
                
                // 4. Reload lại UI
                loadPuzzleManifest('my_puzzles', 'Bài Tập Của Tôi', false);
                showToast(`✅ Đã tải lên file: ${cleanFileName}`);

            } catch (err) {
                showToast("❌ File lỗi: " + err.message);
            }
            hideLoading();
        };
        reader.readAsText(file);
    }

    async function confirmDeletePuzzleFile() {
        closeModal('delete-puz-modal');
        showLoading("Đang xóa...");
        try {
            await deleteWorkspace(pendingDeletePuzKey); // Xóa nội dung
            
            let myPuz = await getWorkspace('my_puzzle');
            
            if (myPuz && myPuz.files) {
                myPuz.files = myPuz.files.filter(f => f.file_key !== pendingDeletePuzKey);
                
                await saveWorkspace('my_puzzle', myPuz);
            }
            
            loadPuzzleManifest('my_puzzles', 'Bài Tập Của Tôi', false); // Render lại
            showToast("✅ Đã xóa bài tập!");
        } catch (err) {
            showToast("❌ Lỗi khi xóa!");
        }
        hideLoading();
    }


    // === LOGIC XỬ LÝ DATA BÊN TRONG FILE (FENS) ===
    let puzzleDomPool = [];
    const PUZ_ITEM_HEIGHT = 48; 
    const PUZ_VISIBLE_ITEMS = 25;

    // SỬA: Thêm tham số isLocal
    async function loadPuzzleFileData(fileName, filePath, isLocal = false) {
        showLoading("Đang tải dữ liệu bài tập...");
        try {
            state.currentPuzzleName = fileName;
            let data;
            if (isLocal) {
                // Đọc từ IndexedDB (với tham số filePath chính là file_key)
                data = await getWorkspace(filePath);
                if (!data) throw new Error("Không tìm thấy dữ liệu trong máy");
            } else {
                // Đọc từ Máy chủ (fetch)
                const response = await fetch(`${filePath}?v=${new Date().getTime()}`);
                if (!response.ok) throw new Error("Lỗi tải file JSON");
                data = await response.json();
            }
            
            if (data.fens && data.fens.length > 0) {
                state.puzzleFens = data.fens;
                state.currentPuzzleMaxMoves = data.max_moves || 1000;

                // TẠO HOẶC LẤY KEY RANDOM TỪ DATABASE
                state.currentPuzzleKey = data.key || fileName; 
                
                // Tìm xem Key này đã được gắn với random suffix nào chưa
                let mappedKey = await getWorkspace('puz_map_' + state.currentPuzzleKey);
                if (!mappedKey) {
                    // Nếu chưa có, khởi tạo Key mới (vd: xpstxst_abcde)
                    mappedKey = state.currentPuzzleKey + makeRandomString(5);
                    await saveWorkspace('puz_map_' + state.currentPuzzleKey, mappedKey);
                    await saveWorkspace('puz_solved_' + mappedKey, []); // Khởi tạo mảng rỗng
                }
                state.currentPuzzleSolvedKey = mappedKey;

                // Lấy mảng các bài đã giải
                let solvedArray = await getWorkspace('puz_solved_' + mappedKey);
                state.currentPuzzleSolved = solvedArray || [];

                // Lấy vị trí bài đang chơi dở
                let savedIndex = await getWorkspace('puz_prog_' + mappedKey);
                state.currentPuzzleIndex = (savedIndex !== null && savedIndex < data.fens.length) ? savedIndex : 0;
                
                state.isViewingPuzzleFens = true;
                document.getElementById('puzzle-manifest-view').style.display = 'none';
                document.getElementById('puzzle-fen-view').style.display = 'flex';
                
                const subtitle = document.getElementById('puzzle-modal-subtitle');
                subtitle.innerText = fileName;
                subtitle.style.display = 'block';
                document.getElementById('btn-puzzle-back').style.display = 'block';

                renderPuzzleVirtualList();
            } else {
                showToast("❌ File không chứa bài tập nào!");
            }
        } catch (err) {
            showToast("❌ File bị lỗi hoặc cấu trúc sai!");
        }
        hideLoading();
    }

    function renderPuzzleVirtualList() {
        const viewport = document.getElementById('puzzle-fen-viewport');
        const spacer = document.getElementById('puzzle-fen-spacer');
        const container = document.getElementById('puzzle-fen-container');

        if (puzzleDomPool.length === 0) {
            container.innerHTML = '';
            for (let i = 0; i < PUZ_VISIBLE_ITEMS; i++) {
                const item = document.createElement('div');
                item.className = 'lib-item'; 
                // Thiết kế Layout Flexbox: 3 CỘT (Cột 1 trống để đẩy Text ra giữa, Cột 2 Text, Cột 3 Icon)
                item.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 15px;">
                        <span style="width: 24px;"></span> <!-- Spacer cân bằng trái -->
                        <span class="lib-title" style="text-align: center; padding: 0; flex: 1;"></span>
                        <span class="puz-status-icon" style="display: flex; align-items: center; justify-content: flex-end; width: 24px;">
                        </span>
                    </div>
                `;
                
                item.onclick = () => {
                    const fenIndex = parseInt(item.dataset.index);
                    
                    if (fenIndex === state.currentPuzzleIndex && state.appMode === 'puzzle') {
                        closeModal('puzzle-modal');
                        return; // Chỉ đóng bảng, không làm gì thêm!
                    }

                    state.currentPuzzleIndex = fenIndex;
                    const selectedFen = state.puzzleFens[fenIndex];

                    saveWorkspace('puz_prog_' + state.currentPuzzleSolvedKey, fenIndex);
                    
                    closeModal('puzzle-modal');
                    switchMode('puzzle', selectedFen);
                    showToast(`Đã mở bài tập số ${fenIndex + 1}!`);
                };

                puzzleDomPool.push(item);
                container.appendChild(item);
            }
            viewport.addEventListener('scroll', () => requestAnimationFrame(updatePuzzleVirtualList));
        }

        spacer.style.height = `${state.puzzleFens.length * PUZ_ITEM_HEIGHT}px`;
        
        const viewportHeight = viewport.clientHeight || 300; 
        let targetScroll = (state.currentPuzzleIndex * PUZ_ITEM_HEIGHT) - (viewportHeight / 2) + (PUZ_ITEM_HEIGHT / 2);
        if (targetScroll < 0) targetScroll = 0; // Tránh cuộn lố lên trên
        viewport.scrollTop = targetScroll;

        updatePuzzleVirtualList();
    }

    function updatePuzzleVirtualList() {
        const viewport = document.getElementById('puzzle-fen-viewport');
        if (!viewport || puzzleDomPool.length === 0) return;

        const scrollTop = viewport.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / PUZ_ITEM_HEIGHT) - 2);
        const endIndex = Math.min(state.puzzleFens.length - 1, startIndex + PUZ_VISIBLE_ITEMS - 1);

        const container = document.getElementById('puzzle-fen-container');
        container.style.transform = `translateY(${startIndex * PUZ_ITEM_HEIGHT}px)`;

        for (let i = 0; i < PUZ_VISIBLE_ITEMS; i++) {
            const dom = puzzleDomPool[i];
            const dataIndex = startIndex + i;

            if (dataIndex <= endIndex) {
                dom.style.display = 'flex';
                dom.dataset.index = dataIndex;
                const titleSpan = dom.querySelector('.lib-title');
                const statusIcon = dom.querySelector('.puz-status-icon');
                
                titleSpan.innerText = `Bài số ${dataIndex + 1}`;

                // --- KIỂM TRA ĐẶC BIỆT NẾU LÀ FILE CHALLENGE ---
                const isChallenge = state.currentPuzzleName === "Thử Thách" || state.currentPuzzleKey.includes("challenge");
                
                // Mảng chứa các index đã giải
                let isSolved = state.currentPuzzleSolved.includes(dataIndex);
                let isActive = (dataIndex === state.currentPuzzleIndex);
                
                // Nếu là Challenge: Nó lưu max_index thay vì mảng. Ta quy ra mảng ngầm định.
                let maxUnlocked = 0;
                if (isChallenge) {
                    const maxSolvedIndex = state.currentPuzzleSolved.length > 0 ? state.currentPuzzleSolved[0] : -1;
                    maxUnlocked = maxSolvedIndex + 1; // Bài đang giải (Bài tiếp theo)

                    isSolved = (dataIndex <= maxSolvedIndex);
                    
                    // Nếu là bài CHƯA GIẢI
                    if (!isSolved) {
                        if (dataIndex === maxUnlocked) {
                            // Đang giải: Chữ xanh, không icon
                            statusIcon.innerHTML = '';
                            titleSpan.style.color = isActive ? '#008a3e' : '#1a73e8';
                            dom.style.opacity = '1';
                            dom.style.pointerEvents = 'auto'; // Cho phép bấm
                        } else {
                            // Chưa tới lượt (Khóa): Chữ xám, Icon ổ khóa
                            statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/></svg>`;
                            titleSpan.style.color = '#262626';
                            dom.style.opacity = '0.6';
                            dom.style.pointerEvents = 'none'; // CẤM BẤM
                        }
                    } else {
                        // Đã giải: Chữ xanh lá, Icon tích
                        statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14a800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`;
                        titleSpan.style.color = '#14a800';
                        dom.style.opacity = '1';
                        dom.style.pointerEvents = 'auto'; // Cho phép bấm chơi lại
                    }
                } 
                // --- XỬ LÝ BÀI TẬP BÌNH THƯỜNG ---
                else {
                    dom.style.opacity = '1';
                    dom.style.pointerEvents = 'auto'; // Cho phép bấm

                    if (isSolved) {
                        statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14a800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`;
                        titleSpan.style.color = '#14a800';
                    } else {
                        statusIcon.innerHTML = '';
                        titleSpan.style.color = isActive ? '#008a3e' : '#1a73e8';
                    }
                }

                // XỬ LÝ FONT WEIGHT & BORDER CỦA DÒNG ĐANG CHỌN (Chung cho 2 chế độ)
                titleSpan.style.fontWeight = isActive ? '900' : 'bold';

                if (isActive) {
                    dom.style.backgroundColor = '#f0fdf4';
                    dom.style.borderLeft = '4px solid #008a3e';
                } else {
                    dom.style.backgroundColor = '#fff';
                    dom.style.borderLeft = 'none';
                }
            } else {
                dom.style.display = 'none';
            }
        }
    }
    function refreshPuzzleListUI() {
        const viewport = document.getElementById('puzzle-fen-viewport');
        if (!viewport || puzzleDomPool.length === 0) return;

        // 1. Tính toán lại vị trí cuộn ra giữa cho bài tập hiện tại
        const viewportHeight = viewport.clientHeight || 300; 
        let targetScroll = (state.currentPuzzleIndex * PUZ_ITEM_HEIGHT) - (viewportHeight / 2) + (PUZ_ITEM_HEIGHT / 2);
        if (targetScroll < 0) targetScroll = 0; 
        
        // Gán lại thanh cuộn
        viewport.scrollTop = targetScroll;

        // 2. Ép hệ thống vẽ lại các nút bấm (Màu xanh / Đen)
        updatePuzzleVirtualList();
    }
    // ====== SỰ KIỆN UPLOAD & XÓA BÀI TẬP CỦA TÔI ======
    const puzzleFileUpload = document.getElementById('puzzle-file-upload');
    if (puzzleFileUpload) {
        puzzleFileUpload.onchange = (e) => {
            handlePuzzleUpload(e.target.files[0]);
            e.target.value = ''; // Reset input
        };
    }

    const btnDelPuzCancel = document.getElementById('btn-del-puz-cancel');
    if (btnDelPuzCancel) btnDelPuzCancel.onclick = () => closeModal('delete-puz-modal');

    const btnDelPuzConfirm = document.getElementById('btn-del-puz-confirm');
    if (btnDelPuzConfirm) btnDelPuzConfirm.onclick = () => confirmDeletePuzzleFile();