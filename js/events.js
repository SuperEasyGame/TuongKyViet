//js/events.js
import { state, storage } from './state.js';
import { getWorkspace , saveWorkspace, deleteWorkspace } from './db.js';
import { toggleAutoPlay, forceStopAIPlayers, jumpToNode, initGame, loadGameFromList } from './game.js';
import { triggerEngineEvaluation, applyEngineSettings, getDeviceTier } from './engine.js';
import { openModal, closeModal, updateTurnToggleUI, showLoading, hideLoading, showToast, renderLibraryList, confirmDeleteLibraryItem, renderMemorizeList, syncBookTabUI } from './ui.js';
import { finishEditing, turnOnEditMode } from './editor.js';
import { handleImageRecognition, handleFileUpload, getMoveListAndComments, copyToClipboard, getVschessNodeTree, downloadFile, getFormattedDate, formatGameInfoString, saveGameState } from './io.js';
import { renderBoardFull, drawBestMoveArrow, clearArrow, updateActiveMoveBadge, renderMoveHistory, getMergedCanvas } from './board.js';
import { START_FEN, VschessErrorDict } from './config.js';
import { uploadLocalBook, deleteLocalBook, loadLocalBookFromDB } from './localbook.js';

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
    const isFloat = !Number.isInteger(step);

    let targetObj;
    if (targetType === 'ai') targetObj = state.aiSettings;
    else if (targetType === 'app') targetObj = state.appSettings;
    else if (targetType === 'bot') targetObj = state.vsBotSettings;
    else if (targetType === 'chart') targetObj = state.chartSettings; 

    if (targetObj[stateKey] !== undefined) {
        input.value = targetObj[stateKey];
    }

    function updateState(isFromUserClick = false) {
        let currentMax = parseFloat(input.getAttribute('max')) || defaultMax;
        let val = parseFloat(input.value);
        
        if (isNaN(val)) val = targetObj[stateKey];
        if (val < min) val = min;
        if (val > currentMax) val = currentMax;
        
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
        btnPlus.disabled = val >= currentMax; 
    }

    btnMinus.onclick = () => {
        let val = parseFloat(input.value);
        if (isHash) {
            let idx = hashValues.indexOf(val);
            if (idx > 0) input.value = hashValues[idx - 1];
        } else {
            if (val - step >= min) {
                input.value = isFloat ? (val - step).toFixed(1) : (val - step);
            }
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
            if (idx < hashValues.length - 1 && hashValues[idx + 1] <= currentMax) {
                input.value = hashValues[idx + 1];
            }
        } else {
            if (val + step <= currentMax) {
                input.value = isFloat ? (val + step).toFixed(1) : (val + step);
            }
        }
        updateState(true);
        
        if (inputId === 'input-setup-level') document.getElementById('input-botlevel').value = input.value;
        if (inputId === 'input-botlevel') document.getElementById('input-setup-level').value = input.value;
    };

    input.onblur = () => updateState(true);
    
    input.oninput = function() {
        if (!isFloat) {
            this.value = this.value.replace(/[^0-9]/g, '');
        } else {
            let val = this.value.replace(/[^0-9.]/g, '');
            let parts = val.split('.');
            if (parts.length > 2) {
                val = parts[0] + '.' + parts.slice(1).join('');
            }
            parts = val.split('.');
            if (parts.length === 2 && parts[1].length > 1) {
                val = parts[0] + '.' + parts[1].substring(0, 1);
            }
            this.value = val;
        }
    };
    
    updateState(false); 
}

function resetAIUI() {
    if (!state.isAnalyzing && !state.aiPlaysRed && !state.aiPlaysBlack) {
        import('./engine.js').then(module => {
            module.forceStopEngine(); 
        });
    }
}

async function switchMode(newMode, customFen = START_FEN, forceNew = false) {
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
    document.querySelectorAll('.tool-btn-outer').forEach(btn => btn.classList.remove('disabled'));
    let targetMenuId = `menu-${newMode}`;
    if (newMode === 'vsbot') targetMenuId = 'menu-bot'; 

    const activeBtn = document.getElementById(targetMenuId);
    if (activeBtn) activeBtn.classList.add('menu-item-active');

    if (state.appMode === newMode && customFen === START_FEN) {
        closeModal('main-menu-modal');
        return;
    }

    showLoading("Đang tải dữ liệu...");

    state.isAnalyzing = false;
    state.aiPlaysRed = false;
    state.aiPlaysBlack = false;

    state.customArrows = []; 

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

    setTimeout(async () => {
        closeModal('main-menu-modal');
        forceStopAIPlayers();
        
        state.appMode = newMode;
        state.appSettings.appMode = newMode;
        
        try { storage.saveSystem(state.appSettings); } catch(e) {}

        if (customFen !== START_FEN || forceNew) {
            await initGame(customFen, false); 
        } else {
            await initGame(START_FEN, true); 
        }
        
        hideLoading(); 
    }, 50);
}

export function finishChartDrawing() {
    import('./ui.js').then(ui => ui.hideAILoading());
    state.isChartDrawing = false;
    document.body.classList.remove('chart-drawing');

    state.isChartAnalyzed = true; 
    
    let temp = state.rootNode;
    while(temp.children.length > 0) {
        temp = temp.children[temp.mainLineIndex];
    }
    
    import('./report.js').then(report => {
        state.chartReport = report.generateReportData();
        
        report.renderReportUI();
        report.renderMistakesUI();
        
        import('./chart.js').then(chart => chart.refreshChartUI());
    });

    import('./game.js').then(game => {
        game.instantJumpToNode(temp, true); 
        
        setTimeout(() => {
            const activeBtn = document.getElementById('active-move-btn');
            if (activeBtn) {
                activeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    });

    import('./engine.js').then(engine => engine.forceStopEngine());
    import('./board.js').then(b => {
        b.renderMoveHistory(); 
        b.renderBoardFull(state.currentSituation);
    });
    
    showToast("Phân tích biểu đồ hoàn tất!");
}

export function exitChartMode() {
    import('./ui.js').then(ui => ui.hideAILoading());
    state.isChartRunning = false;
    state.isChartDrawing = false;
    
    state.isChartAnalyzed = false; 

    document.body.classList.remove('chart-running', 'chart-drawing');
    
    const btnChart = document.getElementById('btn-chart');
    if (btnChart) btnChart.classList.remove('tool-active');
    
    import('./game.js').then(game => {
        game.forceStopAIPlayers();
        game.clearTreeAnalysisData(state.rootNode);
    });

    import('./engine.js').then(engine => engine.restoreEngineAfterChart());
    
    import('./chart.js').then(chart => chart.closeChartUI());

    import('./board.js').then(b => {
        b.clearArrow();
        b.renderMoveHistory(); 
        b.renderBoardFull(state.currentSituation);
    });

    setTimeout(() => {
        const activeBtn = document.getElementById('active-move-btn');
        if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

export function initEvents() {

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('main-menu-panel');
        const btnMenu = document.getElementById('btn-menu');
        if (menu && menu.classList.contains('show-menu') && !menu.contains(e.target) && !btnMenu.contains(e.target)) {
            closeModal('main-menu-modal'); 
            import('./game.js').then(g => g.syncPlayerTimer());
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

        if (state.isChartDrawing) {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
                e.preventDefault();
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
            if (btnHint.classList.contains('disabled')) return;
            
            if (state.appMode === 'memorize') {
                const children = state.currentNode.children;
                if (children.length === 0) return; // Đã đi đến cuối nhánh, không còn gì để gợi ý

                let targetNode = null;
                
                // Nếu User setup chỉ học nhánh chính -> Lấy mặc định nhánh đầu tiên (index 0)
                if (state.memorizeSettings.path === 'main') {
                    targetNode = children[0];
                } 
                // Nếu User setup Tự Chọn hoặc Random -> Random 1 nhánh hợp lệ trong số các biến
                else {
                    const randIdx = Math.floor(Math.random() * children.length);
                    targetNode = children[randIdx];
                }

                // Tự động đi quân vừa được lấy ra
                import('./game.js').then(module => {
                    module.executeForwardStep(targetNode);
                });
                return;
            }

            if (!state.engineModule) return; // Các chế độ khác phải có AI mới chạy được

            if (state.appMode === 'puzzle') {
                btnHint.classList.add('disabled');
                
                const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
                if (isRedTurn) state.aiPlaysRed = true; else state.aiPlaysBlack = true;
                
                import('./engine.js').then(module => {
                    module.triggerEngineEvaluation(); 
                });
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
            import('./timer.js').then(t => {
                t.PlayerTimer.stop();
                if (state.appMode === 'vsbot' && state.vsBotSettings.useTimer) {
                    state.vsBotSettings.remainingTimeMs = t.PlayerTimer.getRemainingMs();
                    storage.saveVsBot(state.vsBotSettings);
                    saveGameState();
                }
            });
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
    if(btnCloseMainMenu) btnCloseMainMenu.onclick = () => { closeModal('main-menu-modal'); import('./game.js').then(g => g.syncPlayerTimer()); };
    
    const menuAnalyze = document.getElementById('menu-analyze');
    if(menuAnalyze) menuAnalyze.onclick = () => { switchMode('analyze'); };
    
    // ====== Đấu Vs Bot ======
    const menuBot = document.getElementById('menu-bot');
    if(menuBot) {
        menuBot.onclick = async () => { 
            if (state.appMode === 'vsbot') {
                closeModal('main-menu-modal');
                import('./game.js').then(g => g.syncPlayerTimer());
                return;
            }
            try {
                const workspace = await getWorkspace('vsbot_workspace');
                if (workspace && workspace.gameList && workspace.gameList.length > 0) {
                    closeModal('main-menu-modal');
                    openModal('vsbot-resume-modal');
                } else {
                    state.vsBotSetupOrigin = 'menu'; 
                    closeModal('main-menu-modal');
                    document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                    openModal('vsbot-setup-modal');
                }
            } catch (e) {
                state.vsBotSetupOrigin = 'menu';
                closeModal('main-menu-modal');
                document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                openModal('vsbot-setup-modal');
            }
        };
    }

    const btnVsbotResumeNew = document.getElementById('btn-vsbot-resume-new');
    if (btnVsbotResumeNew) {
        btnVsbotResumeNew.onclick = () => {
            closeModal('vsbot-resume-modal');
            state.vsBotSetupOrigin = 'menu'; 
            document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
            openModal('vsbot-setup-modal');
        };
    }

    const btnVsbotResumeContinue = document.getElementById('btn-vsbot-resume-continue');
    if (btnVsbotResumeContinue) {
        btnVsbotResumeContinue.onclick = () => {
            closeModal('vsbot-resume-modal');
            switchMode('vsbot'); 
        };
    }

    document.getElementById('btn-setup-cancel').onclick = () => {
        closeModal('vsbot-setup-modal');
        
        if (state.vsBotSetupOrigin === 'menu') {
            openModal('main-menu-modal');
        } 
        else if (state.vsBotSetupOrigin === 'import_mode') {
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
            
            import('./game.js').then(module => {
                module.updateVsBotToolButtons();

                import('./timer.js').then(t => {
                    if (state.vsBotSettings.useTimer) {
                        state.vsBotSettings.remainingTimeMs = t.PlayerTimer.getRemainingMs();
                    }
                    module.syncPlayerTimer(); 
                });
            });
        }
        else if (state.vsBotSetupOrigin === 'toolbar') {
            import('./game.js').then(g => g.syncPlayerTimer());
        }
    };
    document.getElementById('btn-setup-confirm').onclick = () => {
        // --- CẬP NHẬT MỚI: Dùng START_FEN hoặc lấy FEN từ Import ---
        let fenInput = START_FEN;
        if ((state.vsBotSetupOrigin === 'import_mode' || state.vsBotSetupOrigin === 'edit_mode') && state.pendingBotFen) {
            fenInput = state.pendingBotFen;
            state.pendingBotFen = null; // Xoá biến tạm sau khi dùng
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
        
        // --- XỬ LÝ THỜI GIAN ---
        const toggleTimer = document.getElementById('toggle-vsbot-timer');
        if (toggleTimer) {
            state.vsBotSettings.useTimer = toggleTimer.checked;
        }
        if (state.vsBotSettings.useTimer) {
            state.vsBotSettings.remainingTimeMs = state.vsBotSettings.baseTime * 60 * 1000;
        } else {
            state.vsBotSettings.remainingTimeMs = 0;
        }
        
        storage.saveVsBot(state.vsBotSettings);
        closeModal('vsbot-setup-modal');
        deleteWorkspace('vsbot_workspace').then(() => {
            if (state.appMode === 'vsbot') {
                initGame(fenInput, false); 
            } else {
                switchMode('vsbot', fenInput, true); // Truyền thêm 'true' vào forceNew
            }
        });

        if (state.appMode === 'vsbot') {
            initGame(fenInput, false); 
        } else {
            switchMode('vsbot', fenInput); 
        }
    };

    const menuBlind = document.getElementById('menu-blind');
    if(menuBlind) {
        menuBlind.onclick = async () => { 
            try {
                const workspace = await getWorkspace('blind_workspace');
                if (workspace && workspace.gameList && workspace.gameList.length > 0) {
                    switchMode('blind'); 
                } else {
                    switchMode('blind', START_FEN); 
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

        if (state.isViewingPuzzleFens) {
            state.isViewingPuzzleFens = false;
            document.getElementById('puzzle-fen-view').style.display = 'none';
            document.getElementById('puzzle-manifest-view').style.display = 'flex';
            
            if (state.currentPuzzleFolder.name) {
                subtitle.innerText = state.currentPuzzleFolder.name;
                subtitle.style.display = 'block';
            } else {
                subtitle.style.display = 'none'; 
            }
            
            if (state.puzzleHistory.length === 0) btnPuzzleBack.style.display = 'none';
        } 
        else if (state.puzzleHistory.length > 0) {
            const prevFolder = state.puzzleHistory.pop();
            state.currentPuzzleFolder = prevFolder; 
            loadPuzzleManifest(prevFolder.path, prevFolder.name, true);
        }
    };

    const btnNewList = document.getElementById('btn-new-list');
    if (btnNewList) {
        btnNewList.onclick = () => {
            closeModal('new-game-modal');
            state.puzzleOpenedFromMenu = false;
            
            openModal('puzzle-modal');
            
            if (state.isViewingPuzzleFens) {
                setTimeout(() => refreshPuzzleListUI(), 100);
            }
        };
    }

    const btnPuzResList = document.getElementById('btn-puz-res-list');
    if (btnPuzResList) {
        btnPuzResList.onclick = () => {
            closeModal('puzzle-result-modal');
            state.puzzleOpenedFromMenu = false;
            
            openModal('puzzle-modal');
            
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
            }
        };
    }
    
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
            e.target.value = '';
        };
    }

    const memoSetupBlind = document.getElementById('memo-setup-blind');
    const memoSetupPath = document.getElementById('memo-setup-path');
    const memoSetupMethod = document.getElementById('memo-setup-method');
    function syncMemoUI() {
        if (!memoSetupBlind || !memoSetupPath || !memoSetupMethod) return;

        memoSetupPath.disabled = false;
        memoSetupPath.style.opacity = '1';
        memoSetupBlind.disabled = false;
        memoSetupBlind.parentElement.style.opacity = '1';
        memoSetupMethod.disabled = false;
        memoSetupMethod.style.opacity = '1';

        if (memoSetupBlind.checked) {
            memoSetupMethod.value = 'full';
            memoSetupMethod.disabled = true;
            memoSetupMethod.style.opacity = '0.5';

            memoSetupPath.value = 'random';
            memoSetupPath.disabled = true;
            memoSetupPath.style.opacity = '0.5';
        } 
        else if (memoSetupMethod.value === 'segment') {
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
            state.pendingMemorizeData = null; 
            closeModal('memorize-setup-modal');
            openModal('memorize-modal');
        };
    }

    const btnMemoSetupConfirm = document.getElementById('btn-memo-setup-confirm');
    if (btnMemoSetupConfirm) {
        btnMemoSetupConfirm.onclick = () => {
            if (!state.pendingMemorizeData) return;
            
            state.memorizeSettings.side = document.getElementById('memo-setup-side').value;
            state.memorizeSettings.method = document.getElementById('memo-setup-method').value;
            state.memorizeSettings.path = document.getElementById('memo-setup-path').value;
            state.memorizeSettings.isBlind = document.getElementById('memo-setup-blind').checked;

            state.memoMistakesRed = 0;
            state.memoMistakesBlack = 0;
            
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

            import('./game.js').then(m => {
                m.forceStopAIPlayers();

                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                else { state.aiPlaysRed = false; state.aiPlaysBlack = false; }

                state.gameList = [{ info: state.pendingMemorizeData.info, node: state.pendingMemorizeData.node }];
                m.loadGameFromList(0); 
                
                let pathNodes = [];
                let curr = state.rootNode;
                while(curr) {
                    pathNodes.push(curr);
                    if(curr.children.length > 0) curr = curr.children[0];
                    else break;
                }
                
                let totalMoves = pathNodes.length - 1; 

                if (state.memorizeSettings.method === 'segment' && totalMoves > 6) {
                    let maxStart = totalMoves - 6;
                    let startIdx = Math.floor(Math.random() * (maxStart + 1));
                    let maxLen = totalMoves - startIdx;
                    let len = Math.floor(Math.random() * (maxLen - 6 + 1)) + 6;
                    let endIdx = startIdx + len;

                    state.memorizeSettings.startNodeId = pathNodes[startIdx].id;
                    state.memorizeSettings.endNodeId = pathNodes[endIdx].id;
                    
                    m.instantJumpToNode(pathNodes[startIdx]);
                } else {
                    state.memorizeSettings.startNodeId = pathNodes[0].id;
                    state.memorizeSettings.endNodeId = pathNodes[pathNodes.length - 1].id;
                    m.instantJumpToNode(pathNodes[0]);
                }

                m.applyAutoBoardFlip();
                setTimeout(() => m.triggerMemorizeBot(), 300);
            });

            closeModal('memorize-setup-modal');
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
            renderMemorizeList(); 
        };
    }

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

    // ====== Hướng dẫn Thanh công cụ ======
    const menuGuide = document.getElementById('menu-guide');
    if(menuGuide) {
        menuGuide.onclick = () => { 
            import('./ui.js').then(ui => {
                ui.closeModal('main-menu-modal'); 
                ui.openGuidePanel();              
            });
        };
    }
    const btnGuideClose = document.getElementById('btn-guide-close');
    if (btnGuideClose) {
        btnGuideClose.onclick = () => {
            import('./ui.js').then(ui => ui.closeGuidePanel());
        };
    }

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
        if (state.appMode !== 'vsbot') {
            import('./engine.js').then(m => m.applyEngineSettings());
        }
        
        document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
        let currentModeId = `menu-${state.appMode}`;
        if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
        
        const activeBtn = document.getElementById(currentModeId);
        if(activeBtn) activeBtn.classList.add('menu-item-active');
            
        openModal('main-menu-modal'); 
    };

    // =========================================================
    // ĐỒNG BỘ GIỚI HẠN PHẦN CỨNG VỚI GIAO DIỆN (CHUẨN XIANGQIAI)
    // =========================================================
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // 1. TÍNH TOÁN MAX THREADS
    let maxThreads = 1; 
    if (typeof SharedArrayBuffer !== 'undefined') {
        maxThreads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 2;
        if (maxThreads > 16) maxThreads = 16;
    }
    
    const inputThreads = document.getElementById('input-threads');
    if (inputThreads) inputThreads.max = maxThreads;
    
    const descThreads = document.getElementById('desc-threads');
    if (descThreads) {
        descThreads.innerText = maxThreads === 1 ? `Tối đa: 1 luồng (Bản An toàn)` : `Tối đa: ${maxThreads} luồng`;
    }

    if (state.aiSettings.threads > maxThreads) {
        state.aiSettings.threads = maxThreads;
        if (inputThreads) inputThreads.value = maxThreads;
    }

    // 2. TÍNH TOÁN MAX HASH VÀ ĐỒNG BỘ SENTINEL CEILING
    let maxHash = 512;
    const inputHash = document.getElementById('input-hash');
    
    // Đọc trần Max Hash trực tiếp từ HTML (do engine.js set dựa trên SIMD và WebView)
    if (inputHash && inputHash.hasAttribute('max')) {
        maxHash = parseInt(inputHash.getAttribute('max'), 10);
    }

    // Import lấy Trần bộ nhớ an toàn (Sentinel Ceiling) để đề phòng trường hợp tải trang lần đầu
    import('./engine.js').then(engineModule => {
        if (engineModule.EngineSentinel) {
            const hashCeiling = engineModule.EngineSentinel.getHashCeiling();
            if (maxHash > hashCeiling) maxHash = hashCeiling;
            
            if (inputHash) {
                inputHash.setAttribute('max', maxHash);
                // Setup lại Stepper của Hash vì Max đã thay đổi
                setupStepper('hash', 'input-hash', 'btn-hash-minus', 'btn-hash-plus', 32, maxHash, 32, true, 'ai');
            }
            if (state.aiSettings.hash > maxHash) {
                state.aiSettings.hash = maxHash;
                if (inputHash) inputHash.value = maxHash;
                storage.saveAnalysis(state.aiSettings);
            }
        }
    });

    // 3. TÍNH TOÁN MAX DEPTH
    let maxDepth = 255;
    const inputDepth = document.getElementById('input-depth');
    if (inputDepth) inputDepth.setAttribute('max', maxDepth);

    // 4. KHỞI TẠO CÁC NÚT BẤM (+) VÀ (-)
    setupStepper('skill', 'input-skill', 'btn-skill-minus', 'btn-skill-plus', 0, 20, 1, false, 'ai');
    setupStepper('threads', 'input-threads', 'btn-threads-minus', 'btn-threads-plus', 1, maxThreads, 1, false, 'ai');
    // Lưu ý: setupStepper của Hash đã được gọi bên trong promise import() ở trên để đảm bảo nhận đúng maxHash
    setupStepper('multiPV', 'input-multipv', 'btn-multipv-minus', 'btn-multipv-plus', 1, 5, 1, false, 'ai');
    setupStepper('moveTime', 'input-time', 'btn-time-minus', 'btn-time-plus', 0.5, 300, 0.5, false, 'ai');
    setupStepper('depth', 'input-depth', 'btn-depth-minus', 'btn-depth-plus', 1, maxDepth, 1, false, 'ai');
    setupStepper('cloudBookLimit', 'input-cloudlimit', 'btn-cloudlimit-minus', 'btn-cloudlimit-plus', 1, 50, 1, false, 'app');
    setupStepper('level', 'input-botlevel', 'btn-botlevel-minus', 'btn-botlevel-plus', 1, 12, 1, false, 'bot');
    setupStepper('level', 'input-setup-level', 'btn-setup-level-minus', 'btn-setup-level-plus', 1, 12, 1, false, 'bot');
    setupStepper('baseTime', 'input-bot-time', 'btn-bot-time-minus', 'btn-bot-time-plus', 1, 60, 1, false, 'bot');
    setupStepper('increment', 'input-bot-inc', 'btn-bot-inc-minus', 'btn-bot-inc-plus', 0, 30, 1, false, 'bot');
    setupStepper('customDepth', 'input-chart-depth', 'btn-chart-depth-minus', 'btn-chart-depth-plus', 10, 30, 1, false, 'chart');
    setupStepper('customTime', 'input-chart-time', 'btn-chart-time-minus', 'btn-chart-time-plus', 1, 10, 1, false, 'chart');
    
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
    const toggleDrawArrows = document.getElementById('toggle-draw-arrows');
    const toggleSound = document.getElementById('toggle-sound');
    const toggleCloudbook = document.getElementById('toggle-cloudbook');
    const toggleVsBotTimer = document.getElementById('toggle-vsbot-timer');
    const timerSettingsGroup = document.getElementById('vsbot-timer-settings');

    if (toggleVsBotTimer && timerSettingsGroup) {
        toggleVsBotTimer.checked = state.vsBotSettings.useTimer;
        timerSettingsGroup.style.opacity = toggleVsBotTimer.checked ? '1' : '0.5';
        timerSettingsGroup.style.pointerEvents = toggleVsBotTimer.checked ? 'auto' : 'none';
        toggleVsBotTimer.onchange = (e) => {
            state.vsBotSettings.useTimer = e.target.checked;
            timerSettingsGroup.style.opacity = e.target.checked ? '1' : '0.5';
            timerSettingsGroup.style.pointerEvents = e.target.checked ? 'auto' : 'none';
        };
    }

    if(toggleAnimation) toggleAnimation.checked = state.appSettings.animation;
    if(toggleArrows) toggleArrows.checked = state.appSettings.arrows;
    if(toggleDrawArrows) toggleDrawArrows.checked = state.appSettings.allowCustomArrows;
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
    if(toggleDrawArrows) {
        toggleDrawArrows.onchange = (e) => {
            state.appSettings.allowCustomArrows = e.target.checked;
            storage.saveSystem(state.appSettings);
            if (!e.target.checked) {
                state.customArrows = [];
                import('./board.js').then(b => b.renderBoardFull(state.currentSituation));
            }
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
        
        if (state.appMode === 'vsbot') {
            if (btnImportFile) btnImportFile.style.display = 'none'; 
            if (importText) importText.placeholder = "Chỉ dán mã FEN hình cờ tĩnh vào đây...";
        } else {
            if (btnImportFile) btnImportFile.style.display = 'flex'; 
            if (importText) importText.placeholder = "Dán mã FEN, PGN hoặc UBB vào đây...";
        }
        openModal('import-modal'); 
    };
    
    const btnExport = document.getElementById('btn-export');
    if(btnExport) btnExport.onclick = () => { openModal('export-modal'); };

    const btnFlip = document.getElementById('btn-flip');
    if(btnFlip) {
        btnFlip.onclick = (e) => {
            if (state.isChartRunning) {
                return;
            }
            
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
                
                triggerEngineEvaluation(); 
            } else {
                btnAnalyze.classList.remove('tool-active');
            }
            
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
            document.querySelectorAll('.mistake-btn').forEach(b => {
                b.classList.remove('mistake-active-red', 'mistake-active-black');
            });

            if (tabName === 'pikafish' && (state.isChartRunning || state.isChartAnalyzed)) {
                import('./chart.js').then(chart => {
                    setTimeout(() => chart.refreshChartUI(), 10);
                });
            }
        };
    });

    const commentBox = document.getElementById('comment-box');
    if (commentBox) { 
        commentBox.addEventListener('input', function() { 
            if (state.currentNode) 
            {
                state.currentNode.comment = this.value; 
                updateActiveMoveBadge();
            }             
        }); 
    }

    const varBtnConfirm = document.getElementById('var-btn-confirm');
    if(varBtnConfirm) varBtnConfirm.onclick = () => closeModal('variation-modal');
    
    const btnNewCancel = document.getElementById('btn-new-cancel');
    if(btnNewCancel) {
        btnNewCancel.onclick = () => 
        {
            closeModal('new-game-modal');
            import('./game.js').then(g => g.syncPlayerTimer());
        };
     }
    const btnNewGame = document.getElementById('btn-new-game');
    if(btnNewGame) {
        btnNewGame.onclick = () => {
            import('./timer.js').then(t => t.PlayerTimer.stop());
            if (state.isEditMode) { initGame(); return; }

            if (state.appMode === 'memorize') {
                state.memorizeOpenedFromMenu = false;
                openModal('memorize-modal');
                renderMemorizeList();
                return;
            }
            
            if (state.appMode === 'vsbot') {
                state.vsBotSetupOrigin = 'toolbar'; 
                document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                import('./timer.js').then(t => {
                    t.PlayerTimer.stop();
                    if (state.vsBotSettings.useTimer) {
                        state.vsBotSettings.remainingTimeMs = t.PlayerTimer.getRemainingMs();
                        storage.saveVsBot(state.vsBotSettings);
                        saveGameState();
                    }
                });
                openModal('vsbot-setup-modal');
            } else if (state.appMode === 'puzzle') {
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
                state.rootNode.children = [];
                state.rootNode.mainLineIndex = 0;
                m.instantJumpToNode(state.rootNode); 
                
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
                if (state.appMode === 'vsbot') {
                    if (textData.toLowerCase().includes("moves") || textData.includes("[") || textData.includes("DhtmlXQ")) {
                        showToast("❌ Chế độ Đấu Máy chỉ chấp nhận mã FEN hình cờ tĩnh, không nhận biên bản nước đi!");
                        return;
                    }
                    
                    let fenInput = textData;
                    if (!fenInput.includes(" w ") && !fenInput.includes(" b ")) {
                        fenInput += " w - - 0 1";
                    }

                    const errorList = vschess.checkFen(fenInput);
                    if (errorList && errorList.length > 0) {
                        showToast(`❌ Mã FEN không hợp lệ!`);
                        return;
                    }

                    closeModal('import-modal');
                    document.getElementById('import-text').value = '';
                    
                    state.vsBotSetupOrigin = 'import_mode'; 
                    state.pendingBotFen = fenInput;
                    document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                    openModal('vsbot-setup-modal');
                    return;
                }

                showLoading("Đang xử lý dữ liệu...");
                setTimeout(() => {
                    try {
                        const nodeData = vschess.dataToNode(textData);
                        const infoData = vschess.dataToInfo(textData);

                        if (nodeData && nodeData.fen) {
                            state.gameList = [{ info: infoData, node: nodeData }];
                            loadGameFromList(0); 
                            
                            closeModal('import-modal');
                            saveGameState(); 
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
                
                if (state.pendingDownloadType === 'pgn-wxf') {
                    let wxfMoves = vschess.nodeList2moveList(moves, state.rootNode.fen, "wxf", vschess.defaultOptions, false);
                    wxfMoves.shift(); 
                    const pgnData = vschess.moveListToData_PGN(wxfMoves, state.rootNode.fen, comments, state.currentGameInfo, state.currentGameInfo.result);
                    downloadFile(downloadFileName + ".pgn", pgnData);
                } else if (state.pendingDownloadType === 'pgn-iccs') {
                    let iccsDashMoves = moves.map(m => m.substring(0,2) + "-" + m.substring(2,4));
                    const pgnData = vschess.moveListToData_PGN(iccsDashMoves, state.rootNode.fen, comments, state.currentGameInfo, state.currentGameInfo.result);
                    downloadFile(downloadFileName + ".pgn", pgnData); 
                } else if (state.pendingDownloadType === 'xqf') {
                    const binArray = vschess.nodeToBinary_XQF(vNode, state.currentGameInfo, false);
                    downloadFile(downloadFileName + ".xqf", binArray, true);
                } else if (state.pendingDownloadType === 'cbr') {
                    const binArray = vschess.nodeToBinary_CBR(vNode, state.currentGameInfo, false);
                    downloadFile(downloadFileName + ".cbr", binArray, true);
                } else if (state.pendingDownloadType === 'che') {
                    const cheData = vschess.moveListToData_QQ(moves, false);
                    downloadFile(downloadFileName + ".che", cheData);
                }
            } catch(e) { hideLoading(); showToast("❌ Có lỗi xảy ra khi xuất file!"); }
        };
    }

    const expLibrary = document.getElementById('exp-library');
    if(expLibrary) {
        expLibrary.onclick = async () => {
            closeModal('export-modal');
            
            let { moves } = getMoveListAndComments();
            let defaultName = state.currentGameInfo.title || "TuongKyViet";
            if (defaultName === "Tượng Kỳ Việt" && moves.length > 0) defaultName += "_" + getFormattedDate();
            document.getElementById('save-lib-filename').value = defaultName;
            
            const selectEl = document.getElementById('save-lib-folder-select');
            selectEl.innerHTML = '<option value="root">📁 Thư mục gốc</option>';
            
            let list = await getWorkspace('library_workspace') || [];
            let folders = list.filter(item => item.type === "folder");
            
            function buildFolderOptions(parentId, prefix) {
                let children = folders.filter(f => f.parentId === parentId);
                for (let i = 0; i < children.length; i++) {
                    let f = children[i];
                    let isLast = (i === children.length - 1);
                    let nodePrefix = prefix + (isLast ? " └── " : " ├── ");
                    let childPrefix = prefix + (isLast ? "     " : " │   ");
                    
                    let option = document.createElement('option');
                    option.value = f.id;
                    option.innerHTML = (nodePrefix + "📁 " + f.name).replace(/ /g, '&nbsp;');
                    
                    if (f.id === state.currentLibraryFolderId) option.selected = true;
                    
                    selectEl.appendChild(option);
                    buildFolderOptions(f.id, childPrefix);
                }
            }
            
            buildFolderOptions("root", "");
            if (state.currentLibraryFolderId === "root") selectEl.value = "root";

            openModal('save-library-modal');
        };
    }

    // --- XUẤT ẢNH PNG ---
    const expPng = document.getElementById('exp-png');
    if (expPng) {
        expPng.onclick = () => {
            closeModal('export-modal');
            const canvas = getMergedCanvas();
            if (!canvas) { showToast("❌ Lỗi xuất ảnh!"); return; }

            const dataUrl = canvas.toDataURL("image/png");
            const defaultName = state.currentGameInfo.title || "TuongKyViet";
            const filename = `${defaultName}_${getFormattedDate()}.png`;

            // Tự động tải xuống
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast("✅ Đã xuất ảnh PNG thành công!");
        };
    }

    // --- XUẤT ẢNH GIF ĐỘNG ---
    const expGif = document.getElementById('exp-gif');
    if (expGif) {
        expGif.onclick = async () => {
            if (typeof GIF === 'undefined') {
                showToast("❌ Không tìm thấy thư viện tạo GIF!");
                return;
            }
            closeModal('export-modal');
            showLoading("Đang tạo ảnh GIF (0%)...");

            try {
                // Tải worker.js dạng blob để tránh lỗi CORS Web Worker (Rất quan trọng)
                const workerReq = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
                const workerText = await workerReq.text();
                const workerBlob = new Blob([workerText], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(workerBlob);

                // Lấy nhánh lịch sử hiện tại từ đầu tới điểm đang đứng
                let path = [];
                let curr = state.currentNode;
                while (curr) { path.push(curr); curr = curr.parent; }
                path.reverse();

                const canvasMain = document.getElementById('chess-canvas');
                const gif = new GIF({
                    workers: 2,
                    quality: 10, // Số nhỏ = chất lượng cao hơn nhưng render lâu hơn
                    width: canvasMain.width,
                    height: canvasMain.height,
                    workerScript: workerUrl
                });

                // Lưu trạng thái hiện tại để phục hồi sau khi chụp ảnh xong
                const originalNode = state.currentNode;

                import('./game.js').then(async (game) => {
                    game.forceStopAIPlayers();

                    // Duyệt qua từng nước cờ
                    for (let i = 0; i < path.length; i++) {
                        game.instantJumpToNode(path[i], true); // Chuyển bàn cờ im lặng
                        
                        // Đợi canvas render xong (cần 1 khoảng delay nhỏ để vẽ)
                        await new Promise(res => setTimeout(res, 50));

                        const frameCanvas = getMergedCanvas();
                        
                        // Tính toán thời gian dừng (delay) cho mỗi khung hình
                        let delay = 1000; // 1 giây mỗi nước
                        if (i === 0) delay = 1500; // Khung đầu tiên dừng 1.5s
                        if (i === path.length - 1) delay = 3500; // Khung cuối cùng dừng 3.5s

                        gif.addFrame(frameCanvas, { delay: delay, copy: true });
                    }

                    // Phục hồi lại trạng thái ván cờ như cũ
                    game.instantJumpToNode(originalNode, true);
                    if (!state.isChartRunning) {
                        import('./engine.js').then(e => e.triggerEngineEvaluation());
                    }

                    gif.on('progress', p => {
                        const overlay = document.getElementById('loading-overlay');
                        if (overlay) {
                            const h2 = overlay.querySelector('h2');
                            if (h2) h2.innerText = `Đang tạo ảnh GIF (${Math.round(p * 100)}%)...`;
                        }
                    });

                    gif.on('finished', function(blob) {
                        hideLoading();
                        URL.revokeObjectURL(workerUrl); // Giải phóng RAM Worker

                        const defaultName = state.currentGameInfo.title || "TuongKyViet";
                        const filename = `${defaultName}_${getFormattedDate()}.gif`;

                        // Tự động tải xuống
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(a.href);

                        showToast("✅ Đã xuất ảnh GIF thành công!");
                    });

                    // Bắt đầu render
                    gif.render();
                });

            } catch (e) {
                hideLoading();
                showToast("❌ Lỗi mạng hoặc cấu hình khi tạo ảnh GIF!");
                console.error(e);
            }
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

    // ==========================================
    // XỬ LÝ LOCAL BOOK & CLOUD BOOK
    // ==========================================
    const bookTypeSelect = document.getElementById('book-type-select');
    const rowLocalBook = document.getElementById('row-local-book');
    const btnUploadLocal = document.getElementById('btn-upload-local-book');
    const inputLocalFile = document.getElementById('input-local-book-file');
    const btnDeleteLocal = document.getElementById('btn-delete-local-book');
    const localBookTitle = document.getElementById('local-book-title');
    const localBookFilename = document.getElementById('local-book-filename');

    syncBookTabUI();

    if (bookTypeSelect) {
        if (bookTypeSelect.value === 'local') {
            if (rowLocalBook) rowLocalBook.style.display = 'flex';
            loadLocalBookFromDB();
        }

        bookTypeSelect.onchange = (e) => {
            const val = e.target.value;
            state.appSettings.bookType = val;
            storage.saveSystem(state.appSettings);
            
            syncBookTabUI();
            
            if (val === 'local') {
                if (rowLocalBook) rowLocalBook.style.display = 'flex';
                loadLocalBookFromDB(); 
            } else {
                if (rowLocalBook) rowLocalBook.style.display = 'none';
                import('./engine.js').then(m => m.fetchCloudBook(state.currentNode.fen));
            }
        };
    }

    if (btnUploadLocal && inputLocalFile) {
        btnUploadLocal.onclick = () => inputLocalFile.click();

        inputLocalFile.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (localBookTitle) localBookTitle.innerText = "Đang xử lý...";
            if (localBookFilename) {
                localBookFilename.innerText = file.name;
                localBookFilename.style.color = "#008a3e";
            }
            
            uploadLocalBook(file);
            e.target.value = '';
        };
    }

    if (btnDeleteLocal) {
        btnDeleteLocal.onclick = () => {
            const fileName = document.getElementById('local-book-filename')?.innerText || "File Book";
            const nameEl = document.getElementById('delete-local-book-name');
            if (nameEl) nameEl.innerText = fileName;
            openModal('delete-local-book-modal');
        };
    }

    const btnDelLocalCancel = document.getElementById('btn-del-local-book-cancel');
    if (btnDelLocalCancel) {
        btnDelLocalCancel.onclick = () => {
            closeModal('delete-local-book-modal'); 
        };
    }

    const btnDelLocalConfirm = document.getElementById('btn-del-local-book-confirm');
    if (btnDelLocalConfirm) {
        btnDelLocalConfirm.onclick = () => {
            closeModal('delete-local-book-modal'); 
            if (inputLocalFile) inputLocalFile.value = '';
            deleteLocalBook(); 
        };
    }

    // === LOGIC XỬ LÝ MANIFEST VÀ LOCAL DB ===
    async function loadPuzzleManifest(folderPath, folderName = '', isBack = false) {
        showLoading("Đang tải danh sách...");
        state.isViewingPuzzleFens = false;
        
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

        if (folderPath === 'my_puzzles') {
            try {
                const btnUpload = document.createElement('button');
                btnUpload.className = 'import-btn btn-blue';
                btnUpload.style.cssText = 'width: 100%; margin-bottom: 5px; flex-shrink: 0;';
                btnUpload.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Tải File JSON Bài Tập`;
                btnUpload.onclick = () => document.getElementById('puzzle-file-upload').click();
                container.appendChild(btnUpload);

                let myPuzData = await getWorkspace('my_puzzle');
                if (!myPuzData || !myPuzData.files || myPuzData.files.length === 0) {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.style.cssText = 'text-align:center; color:#888; margin-top:20px; font-size:14px;';
                    emptyDiv.innerText = 'Chưa có bài tập nào. Hãy tải lên file JSON!';
                    container.appendChild(emptyDiv);
                } else {
                    myPuzData.files.forEach(file => {
                        const item = document.createElement('div');
                        item.className = 'lib-item'; 
                        item.style.cssText = 'border-radius: 8px; border: 1px solid #eee; margin-bottom: 2px;';
                        item.innerHTML = `
                            <span class="puzzle-icon" style="margin-right:8px;">📄</span>
                            <span class="lib-title">${file.file_name}</span>
                            <button class="lib-btn-del" title="Xóa file này">
                                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            </button>
                        `;

                        item.onclick = (e) => {
                            if(e.target.closest('.lib-btn-del')) return; 
                            loadPuzzleFileData(file.file_name, file.file_key, true); 
                        };

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
            return; 
        }

        try {
            let isDevUnlocked = false;
            if (folderPath === 'data') {
                const devKey = await getWorkspace('dev_puzzle_unlocked');
                if (devKey) isDevUnlocked = true;
            }

            const response = await fetch(`${folderPath}/manifest.json`);
            if (!response.ok) throw new Error("Không tìm thấy file manifest");
            
            const data = await response.json();

            if (folderPath === 'data' && isDevUnlocked) {
                if (!data.folders) data.folders = [];
                data.folders.unshift({
                    folder_name: "Bài Tập Của Tôi",
                    folder_path: "my_puzzles" 
                });
            }

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

            if (data.files && data.files.length > 0) {
                data.files.forEach(file => {
                    const btn = document.createElement('button');
                    btn.className = 'puzzle-item';
                    btn.innerHTML = `<span class="puzzle-icon">📄</span><span class="puzzle-name">${file.file_name}</span>`;
                    btn.onclick = () => {
                        loadPuzzleFileData(file.file_name, file.file_path, false); 
                    };
                    container.appendChild(btn);
                });
            }

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


    function handlePuzzleUpload(file) {
        if (!file) return;
        const reader = new FileReader();
        showLoading("Đang kiểm tra file JSON...");

        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                const keys = Object.keys(data);
                const requiredKeys = ['max_moves', 'key', 'fens'];
                
                const isStrictlyValid = keys.length === 3 && 
                                        requiredKeys.every(k => keys.includes(k)) && 
                                        Array.isArray(data.fens);

                if (!isStrictlyValid) {
                    throw new Error("Cấu trúc JSON không hợp lệ. Chỉ chấp nhận các key: max_moves, key, fens.");
                }

                const timeSuffix = getFormattedDate();
                const newFileKey = 'puz_' + Math.floor(Math.random()*1000) + '_' + timeSuffix;
                
                await saveWorkspace(newFileKey, data);
                
                let myPuz = await getWorkspace('my_puzzle');
                if (!myPuz) myPuz = { files: [] };
                
                const cleanFileName = file.name.replace('.json', '');
                myPuz.files.push({ file_name: cleanFileName, file_key: newFileKey });
                await saveWorkspace('my_puzzle', myPuz);
                
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
            await deleteWorkspace(pendingDeletePuzKey); 
            
            let myPuz = await getWorkspace('my_puzzle');
            
            if (myPuz && myPuz.files) {
                myPuz.files = myPuz.files.filter(f => f.file_key !== pendingDeletePuzKey);
                
                await saveWorkspace('my_puzzle', myPuz);
            }
            
            loadPuzzleManifest('my_puzzles', 'Bài Tập Của Tôi', false); 
            showToast("✅ Đã xóa bài tập!");
        } catch (err) {
            showToast("❌ Lỗi khi xóa!");
        }
        hideLoading();
    }


    let puzzleDomPool = [];
    const PUZ_ITEM_HEIGHT = 48; 
    const PUZ_VISIBLE_ITEMS = 25;

    async function loadPuzzleFileData(fileName, filePath, isLocal = false) {
        showLoading("Đang tải dữ liệu bài tập...");
        try {
            state.currentPuzzleName = fileName;
            let data;
            if (isLocal) {
                data = await getWorkspace(filePath);
                if (!data) throw new Error("Không tìm thấy dữ liệu trong máy");
            } else {
                const response = await fetch(`${filePath}`);
                if (!response.ok) throw new Error("Lỗi tải file JSON");
                data = await response.json();
            }
            
            if (data.fens && data.fens.length > 0) {
                state.puzzleFens = data.fens;
                state.currentPuzzleMaxMoves = data.max_moves || 1000;

                state.currentPuzzleKey = data.key || fileName; 
                
                let mappedKey = await getWorkspace('puz_map_' + state.currentPuzzleKey);
                if (!mappedKey) {
                    mappedKey = state.currentPuzzleKey + makeRandomString(5);
                    await saveWorkspace('puz_map_' + state.currentPuzzleKey, mappedKey);
                    await saveWorkspace('puz_solved_' + mappedKey, []); 
                }
                state.currentPuzzleSolvedKey = mappedKey;

                let solvedArray = await getWorkspace('puz_solved_' + mappedKey);
                state.currentPuzzleSolved = solvedArray || [];

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
                item.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 15px;">
                        <span style="width: 24px;"></span> 
                        <span class="lib-title" style="text-align: center; padding: 0; flex: 1;"></span>
                        <span class="puz-status-icon" style="display: flex; align-items: center; justify-content: flex-end; width: 24px;">
                        </span>
                    </div>
                `;
                
                item.onclick = () => {
                    const fenIndex = parseInt(item.dataset.index);
                    const selectedFen = state.puzzleFens[fenIndex];
                    
                    if (state.appMode === 'puzzle' && state.rootNode && state.rootNode.fen === selectedFen) {
                        closeModal('puzzle-modal');
                        return; 
                    }

                    state.currentPuzzleIndex = fenIndex;

                    saveWorkspace('puz_prog_' + state.currentPuzzleSolvedKey, fenIndex);
                    
                    closeModal('puzzle-modal');
                    switchMode('puzzle', selectedFen);
                };

                puzzleDomPool.push(item);
                container.appendChild(item);
            }
            viewport.addEventListener('scroll', () => requestAnimationFrame(updatePuzzleVirtualList));
        }

        spacer.style.height = `${state.puzzleFens.length * PUZ_ITEM_HEIGHT}px`;
        
        const viewportHeight = viewport.clientHeight || 300; 
        let targetScroll = (state.currentPuzzleIndex * PUZ_ITEM_HEIGHT) - (viewportHeight / 2) + (PUZ_ITEM_HEIGHT / 2);
        if (targetScroll < 0) targetScroll = 0; 
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

                const isChallenge = state.currentPuzzleName === "Thử Thách" || state.currentPuzzleKey.includes("challenge");
                
                let isSolved = state.currentPuzzleSolved.includes(dataIndex);
                let isActive = (dataIndex === state.currentPuzzleIndex);
                
                let maxUnlocked = 0;
                if (isChallenge) {
                    const maxSolvedIndex = state.currentPuzzleSolved.length > 0 ? state.currentPuzzleSolved[0] : -1;
                    maxUnlocked = maxSolvedIndex + 1; 

                    isSolved = (dataIndex <= maxSolvedIndex);
                    
                    if (!isSolved) {
                        if (dataIndex === maxUnlocked) {
                            statusIcon.innerHTML = '';
                            titleSpan.style.color = isActive ? '#008a3e' : '#1a73e8';
                            dom.style.opacity = '1';
                            dom.style.pointerEvents = 'auto'; 
                        } else {
                            statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/></svg>`;
                            titleSpan.style.color = '#262626';
                            dom.style.opacity = '0.6';
                            dom.style.pointerEvents = 'none'; 
                        }
                    } else {
                        statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14a800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`;
                        titleSpan.style.color = '#14a800';
                        dom.style.opacity = '1';
                        dom.style.pointerEvents = 'auto'; 
                    }
                } 
                else {
                    dom.style.opacity = '1';
                    dom.style.pointerEvents = 'auto'; 

                    if (isSolved) {
                        statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14a800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`;
                        titleSpan.style.color = '#14a800';
                    } else {
                        statusIcon.innerHTML = '';
                        titleSpan.style.color = isActive ? '#008a3e' : '#1a73e8';
                    }
                }

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

        const viewportHeight = viewport.clientHeight || 300; 
        let targetScroll = (state.currentPuzzleIndex * PUZ_ITEM_HEIGHT) - (viewportHeight / 2) + (PUZ_ITEM_HEIGHT / 2);
        if (targetScroll < 0) targetScroll = 0; 
        
        viewport.scrollTop = targetScroll;

        updatePuzzleVirtualList();
    }
    const puzzleFileUpload = document.getElementById('puzzle-file-upload');
    if (puzzleFileUpload) {
        puzzleFileUpload.onchange = (e) => {
            handlePuzzleUpload(e.target.files[0]);
            e.target.value = ''; 
        };
    }

    const btnDelPuzCancel = document.getElementById('btn-del-puz-cancel');
    if (btnDelPuzCancel) btnDelPuzCancel.onclick = () => closeModal('delete-puz-modal');

    const btnDelPuzConfirm = document.getElementById('btn-del-puz-confirm');
    if (btnDelPuzConfirm) btnDelPuzConfirm.onclick = () => confirmDeletePuzzleFile();

    // ==========================================
    // CÁC SỰ KIỆN NÚT BẤM CHO THƯ VIỆN CÂY
    // ==========================================
    
    const btnLibBack = document.getElementById('btn-lib-back');
    if (btnLibBack) {
        btnLibBack.onclick = () => {
            if (state.libraryHistory.length > 0) {
                state.currentLibraryFolderId = state.libraryHistory.pop();
                import('./ui.js').then(ui => ui.renderLibraryList());
            }
        };
    }

    const btnLibAddFolder = document.getElementById('btn-lib-add-folder');
    if (btnLibAddFolder) {
        btnLibAddFolder.onclick = () => {
            import('./ui.js').then(ui => {
                ui.setPendingLibAction({ id: "", type: "folder", name: "" });
                
                document.getElementById('folder-action-title').innerText = "Tạo Thư Mục Mới";
                document.getElementById('input-folder-name').value = "";
                openModal('folder-action-modal');
            });
        };
    }

    const btnFolderCancel = document.getElementById('btn-folder-cancel');
    if (btnFolderCancel) btnFolderCancel.onclick = () => closeModal('folder-action-modal');

    const btnFolderConfirm = document.getElementById('btn-folder-confirm');
    if (btnFolderConfirm) {
        btnFolderConfirm.onclick = async () => {
            const folderName = document.getElementById('input-folder-name').value.trim();
            if (!folderName) {
                showToast("❌ Tên thư mục không được để trống!");
                return;
            }
            
            showLoading("Đang xử lý...");
            import('./ui.js').then(async (ui) => {
                let list = await getWorkspace('library_workspace') || [];
                
                if (ui.pendingLibAction.id) {
                    let folder = list.find(f => f.id === ui.pendingLibAction.id);
                    if (folder) folder.name = folderName;
                    await saveWorkspace('library_workspace', list);
                    showToast("✅ Đổi tên thành công!");
                } else {
                    const newFolder = {
                        id: 'folder_' + Date.now(),
                        type: 'folder',
                        name: folderName,
                        parentId: state.currentLibraryFolderId 
                    };
                    list.push(newFolder);
                    await saveWorkspace('library_workspace', list);
                    showToast("✅ Tạo thư mục thành công!");
                }
                
                closeModal('folder-action-modal');
                ui.renderLibraryList();
            });
        };
    }

    const btnSaveLibCancel = document.getElementById('btn-save-lib-cancel');
    if (btnSaveLibCancel) {
        btnSaveLibCancel.onclick = () => {
            closeModal('save-library-modal');
            openModal('export-modal');
        };
    }

    const btnSaveLibConfirm = document.getElementById('btn-save-lib-confirm');
    if (btnSaveLibConfirm) {
        btnSaveLibConfirm.onclick = async () => {
            const rawFileName = document.getElementById('save-lib-filename').value.trim() || "TuongKyViet";
            const targetFolderId = document.getElementById('save-lib-folder-select').value;
            
            closeModal('save-library-modal');
            showLoading("Đang lưu vào thư viện...");
            
            try {
                let vNode = getVschessNodeTree(state.rootNode);
                const gameDataText = vschess.nodeToData_DhtmlXQ(vNode, state.currentGameInfo, false);
                
                const idKey = 'lib_' + Date.now();
                await saveWorkspace(idKey, gameDataText); 
                
                let libraryList = await getWorkspace('library_workspace') || [];
                libraryList.push({ 
                    id: idKey, 
                    type: 'file',
                    name: rawFileName,
                    parentId: targetFolderId 
                });
                
                await saveWorkspace('library_workspace', libraryList);
                
                hideLoading();
                showToast(`✅ Đã lưu "${rawFileName}" vào Thư viện thành công!`);
            } catch(e) {
                hideLoading(); 
                showToast("❌ Có lỗi xảy ra khi lưu!"); 
            }
        };
    }
    const btnMemoBack = document.getElementById('btn-memo-back');
    if (btnMemoBack) {
        btnMemoBack.onclick = () => {
            if (state.memoHistory.length > 0) {
                state.currentMemoFolderId = state.memoHistory.pop();
                import('./ui.js').then(ui => ui.renderMemorizeList());
            }
        };
    }

    // ==========================================
    // CÁC SỰ KIỆN NÚT BẤM CHO CHỌN GIAO DIỆN (STYLE)
    // ==========================================
    let styleManifest = null;
    let currentSelectionType = ''; 
    let tempSelectedStyleObj = null; 
    
    function getStyleNameFromPath(manifestList, path) {
        if (!manifestList) return "Mặc Định";
        const found = manifestList.find(item => item.path === path);
        return found ? found.name : "Mặc Định";
    }

    async function loadStyleManifest() {
        if (styleManifest) return styleManifest;
        try {
            const response = await fetch('style/manifest.json');
            styleManifest = await response.json();
            return styleManifest;
        } catch (e) {
            console.error("Lỗi khi tải style/manifest.json", e);
            return { boards: [], pieces: [] };
        }
    }

    async function openStyleModal(type) {
        showLoading("Đang tải danh sách...");
        const manifest = await loadStyleManifest();
        hideLoading();

        currentSelectionType = type;
        const isBoard = (type === 'board');
        
        document.getElementById('style-select-title').innerText = isBoard ? "Chọn Bàn Cờ" : "Chọn Quân Cờ";
        
        const listData = isBoard ? manifest.boards : manifest.pieces;
        const savedPath = isBoard ? state.appSettings.boardStyle : state.appSettings.pieceStyle;
        
        tempSelectedStyleObj = listData.find(item => item.path === savedPath) || listData[0];

        const elText = document.getElementById(isBoard ? 'current-board-name' : 'current-piece-name');
        if (elText) elText.innerText = tempSelectedStyleObj.name;

        const container = document.getElementById('style-list-container');
        container.innerHTML = '';

        if (!listData || listData.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #888; padding: 20px 0;">Không tìm thấy dữ liệu</div>';
        } else {
            listData.forEach(item => {
                const btn = document.createElement('button');
                btn.className = 'style-item-btn';
                btn.innerText = item.name;

                if (item.path === tempSelectedStyleObj.path) {
                    btn.classList.add('style-item-active');
                }

                btn.onclick = () => {
                    container.querySelectorAll('.style-item-btn').forEach(b => b.classList.remove('style-item-active'));
                    btn.classList.add('style-item-active');
                    tempSelectedStyleObj = item; 
                };

                container.appendChild(btn);
            });
        }

        import('./ui.js').then(ui => ui.openModal('style-select-modal'));
    }

    loadStyleManifest().then(manifest => {
        const boardEl = document.getElementById('current-board-name');
        if (boardEl) boardEl.innerText = getStyleNameFromPath(manifest.boards, state.appSettings.boardStyle);
        
        const pieceEl = document.getElementById('current-piece-name');
        if (pieceEl) pieceEl.innerText = getStyleNameFromPath(manifest.pieces, state.appSettings.pieceStyle);
    });

    const rowBoardStyle = document.getElementById('row-board-style');
    if (rowBoardStyle) {
        rowBoardStyle.onclick = () => openStyleModal('board');
        rowBoardStyle.onmouseenter = function() { this.style.backgroundColor = "#f5f5f5"; };
        rowBoardStyle.onmouseleave = function() { this.style.backgroundColor = "transparent"; };
    }

    const rowPieceStyle = document.getElementById('row-piece-style');
    if (rowPieceStyle) {
        rowPieceStyle.onclick = () => openStyleModal('piece');
        rowPieceStyle.onmouseenter = function() { this.style.backgroundColor = "#f5f5f5"; };
        rowPieceStyle.onmouseleave = function() { this.style.backgroundColor = "transparent"; };
    }

    const btnStyleCancel = document.getElementById('btn-style-cancel');
    if (btnStyleCancel) {
        btnStyleCancel.onclick = () => {
            import('./ui.js').then(ui => ui.closeModal('style-select-modal'));
        };
    }

    const btnStyleConfirm = document.getElementById('btn-style-confirm');
    if (btnStyleConfirm) {
        btnStyleConfirm.onclick = () => {
            import('./ui.js').then(ui => ui.closeModal('style-select-modal'));
            
            const isBoard = (currentSelectionType === 'board');
            const savedPath = isBoard ? state.appSettings.boardStyle : state.appSettings.pieceStyle;

            if (savedPath === tempSelectedStyleObj.path) return;

            showLoading("Đang áp dụng giao diện...");
            
            const startLoadTime = Date.now();

            import('./board.js').then(boardModule => {
                let loadPromise;

                if (isBoard) {
                    state.appSettings.boardStyle = tempSelectedStyleObj.path;
                    loadPromise = boardModule.reloadBoardImage(tempSelectedStyleObj.path);
                    const el = document.getElementById('current-board-name');
                    if (el) el.innerText = tempSelectedStyleObj.name;
                } else {
                    state.appSettings.pieceStyle = tempSelectedStyleObj.path;
                    loadPromise = boardModule.reloadPieceImages(tempSelectedStyleObj.path);
                    const el = document.getElementById('current-piece-name');
                    if (el) el.innerText = tempSelectedStyleObj.name;
                }

                storage.saveSystem(state.appSettings);

                loadPromise.then(() => {
                    const elapsed = Date.now() - startLoadTime;
                    const remainingTime = Math.max(0, 500 - elapsed);
                    
                    setTimeout(() => {
                        hideLoading();
                        showToast(`Đã thay đổi ${isBoard ? "Bàn cờ" : "Quân cờ"} thành công!`);
                    }, remainingTime);
                });
            });
        };
    }

    // ==========================================
    // CÁC SỰ KIỆN CHO TÍNH NĂNG BIỂU ĐỒ PHÂN TÍCH
    // ==========================================
    
    const CHART_PRESETS = {
        very_fast: { depth: 12, time: 1 },
        fast:      { depth: 14, time: 2 },
        normal:    { depth: 16, time: 3 },
        deep:      { depth: 18, time: 5 },
        very_deep: { depth: 20, time: 8 }
    };

    const chartModeSelect = document.getElementById('chart-mode-select');
    const chartPresetSelect = document.getElementById('chart-preset-select');
    const chartPresetGroup = document.getElementById('chart-preset-group');
    const chartCustomGroup = document.getElementById('chart-custom-group');

    if (chartModeSelect && chartPresetSelect) {
        chartModeSelect.value = state.chartSettings.mode || 'preset';
        chartPresetSelect.value = state.chartSettings.preset || 'fast';

        const updateChartSetupUI = () => {
            if (chartModeSelect.value === 'preset') {
                chartPresetGroup.style.display = 'flex';
                chartCustomGroup.style.display = 'none';
            } else {
                chartPresetGroup.style.display = 'none';
                chartCustomGroup.style.display = 'block';
            }
        };

        chartModeSelect.onchange = (e) => {
            state.chartSettings.mode = e.target.value;
            updateChartSetupUI();
        };

        chartPresetSelect.onchange = (e) => {
            state.chartSettings.preset = e.target.value;
        };

        updateChartSetupUI();
    }

    const btnChart = document.getElementById('btn-chart');
    if (btnChart) {
        btnChart.onclick = () => {
            if (state.isChartRunning) {
                exitChartMode();
            } else {
                openModal('chart-setup-modal');
            }
        };
    }

    const btnChartCancel = document.getElementById('btn-chart-cancel');
    if (btnChartCancel) {
        btnChartCancel.onclick = () => { closeModal('chart-setup-modal'); };
    }

    const btnChartConfirm = document.getElementById('btn-chart-confirm');
    if (btnChartConfirm) {
        btnChartConfirm.onclick = () => {
            closeModal('chart-setup-modal');

            if (state.chartSettings.mode === 'preset') {
                const selectedPreset = CHART_PRESETS[state.chartSettings.preset];
                state.chartSettings.runDepth = selectedPreset.depth;
                state.chartSettings.runTime = selectedPreset.time;
            } else {
                state.chartSettings.runDepth = state.chartSettings.customDepth;
                state.chartSettings.runTime = state.chartSettings.customTime;
            }

            state.customArrows = [];
            
            const pikaTab = document.querySelector('.ai-tab-btn[data-tab="pikafish"]');
            if (pikaTab) pikaTab.click();

            import('./game.js').then(game => {
                game.forceStopAIPlayers(); 
                if (state.isAutoPlaying) game.toggleAutoPlay();
            });

            const btnAnalyze = document.getElementById('btn-analyze');
            if (btnAnalyze) {
                btnAnalyze.classList.remove('tool-active');
                state.isAnalyzing = false;
            }

            import('./engine.js').then(engine => {
                engine.forceStopEngine(); 
                
                setTimeout(() => {
                    state.isChartRunning = true;
                    state.isChartDrawing = true;
                    document.body.classList.add('chart-running', 'chart-drawing'); 
                    
                    if (btnChart) btnChart.classList.add('tool-active');
                    
                    engine.startChartAnalysisProcess();
                }, 300);
            });
        };
    }

    // SỰ KIỆN NÚT CHÚ GIẢI BIỂU ĐỒ (LEGEND)
    const btnChartLegend = document.getElementById('btn-chart-legend');
    if (btnChartLegend) {
        btnChartLegend.onclick = () => {
            if (state.isChartDrawing || !state.isChartAnalyzed) return;

            const container = document.getElementById('legend-list-container');
            if (container) {
                // Dữ liệu mapping chuẩn với hàm phân loại analyzer.js (Bỏ missed_win)
                const legendData = [
                    { id: 'best',       name: 'Tốt nhất',        percent: '98 - 100%' },
                    { id: 'excellent',  name: 'Xuất sắc',        percent: '90 - 97%' },
                    { id: 'good',       name: 'Tốt',             percent: '80 - 89%' },
                    { id: 'balanced',   name: 'Cân bằng',        percent: '70 - 79%' },
                    { id: 'inaccuracy', name: 'Thiếu chính xác', percent: '55 - 69%' },
                    { id: 'mistake',    name: 'Sai lầm',         percent: '40 - 54%' },
                    { id: 'blunder',    name: 'Sai lầm nặng',    percent: '0 - 39%' }
                ];

                let htmlContent = '';
                
                // Render danh sách nhãn dán
                legendData.forEach(item => {
                    htmlContent += `
                        <div class="legend-row">
                            <img class="legend-icon" src="style/tags/${item.id}.webp" alt="${item.name}">
                            <span class="legend-name">${item.name} :</span>
                            <div class="legend-dots"></div>
                            <span class="legend-desc">Phù hợp ${item.percent}</span>
                        </div>
                    `;
                });

                // Render Mũi tên AI ở dưới cùng
                htmlContent += `
                    <div class="legend-row" style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 15px;">
                        <svg viewBox="0 0 24 24" fill="#008a3eb9" style="width: 26px; height: 26px; margin-right: 17px; filter: drop-shadow(1px 2px 2px rgba(0,0,0,0.2));">
                            <path d="M12 2L2 12h5v8h10v-8h5L12 2z"/>
                        </svg>
                        <span class="legend-desc" style="color: #008a3eb9; font-weight: bold; text-align: left; flex: 1;">
                            Mũi tên màu xanh lá = Nước đi được AI đề xuất.
                        </span>
                    </div>
                `;

                container.innerHTML = htmlContent;
            }

            import('./ui.js').then(ui => ui.openModal('chart-legend-modal'));
        };
    }
}