// js/engine.js
import { drawBestMoveArrow, clearArrow } from './board.js';
import { customTranslator, executeMove } from './game.js'; 
import { showToast, showAILoading, hideAILoading } from './ui.js';
import { getStrictLegalMoves } from './rules.js';
import { state, storage } from './state.js'; // Thêm storage vào đây

let pendingAction = null; 
let stopTimeoutId = null; 
let isEngineSearching = false; 
let cloudBookTimeoutId = null; 
let lastUiUpdateTime = 0;

let currentEngineInstance = null; // Lưu trữ Worker (nếu là single) hoặc Module (nếu là multi)
let currentWasmType = null;
let fallbackTriggered = false;

export function getDeviceTier() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return 'PC';

    // Nhận diện RAM (Chỉ hoạt động trên Chromium)
    let ram = navigator.deviceMemory || 0;
    
    // Fallback cho iOS/Safari (Không hỗ trợ deviceMemory)
    if (ram === 0) {
        const cores = navigator.hardwareConcurrency || 2;
        ram = cores >= 6 ? 6 : 4; // iPhone từ 6 lõi trở lên thường khá mạnh (Tương đương 6GB)
    }

    if (ram < 6) return 'MOBILE_LOW';
    return 'MOBILE_HIGH';
}

export let botProfiles = { 
    standard: [
        {id: 1, levelName: "Cấp 1", uciSkillLevel: 0, searchDepth: 4, maxMovetimeMs: 200},
        {id: 2, levelName: "Cấp 2", uciSkillLevel: 2, searchDepth: 6, maxMovetimeMs: 400},
        {id: 3, levelName: "Cấp 3", uciSkillLevel: 4, searchDepth: 8, maxMovetimeMs: 600},
        {id: 4, levelName: "Cấp 4", uciSkillLevel: 6, searchDepth: 10, maxMovetimeMs: 800},
        {id: 5, levelName: "Cấp 5", uciSkillLevel: 9, searchDepth: 12, maxMovetimeMs: 1000},
        {id: 6, levelName: "Cấp 6", uciSkillLevel: 12, searchDepth: 14, maxMovetimeMs: 1200},
        {id: 7, levelName: "Cấp 7", uciSkillLevel: 15, searchDepth: 16, maxMovetimeMs: 1500},
        {id: 8, levelName: "Cấp 8", uciSkillLevel: 17, searchDepth: 18, maxMovetimeMs: 2000},
        {id: 9, levelName: "Cấp 9", uciSkillLevel: 19, searchDepth: 20, maxMovetimeMs: 2500},
        {id: 10, levelName: "Cấp 10", uciSkillLevel: 20, searchDepth: 24, maxMovetimeMs: 3500}
    ], 
    human: [
        {id: 1, uciSkillLevel: 20, searchDepth: 5, maxMovetimeMs: 500, multiPVCount: 4, pvProbabilities: [0.10, 0.20, 0.30, 0.40], maxCentipawnDrop: 400, minFakeThinkTime: 0.6, maxFakeThinkTime: 0.8},
        {id: 2, uciSkillLevel: 20, searchDepth: 10, maxMovetimeMs: 700, multiPVCount: 4, pvProbabilities: [0.25, 0.25, 0.25, 0.25], maxCentipawnDrop: 250, minFakeThinkTime: 0.8, maxFakeThinkTime: 1.0},
        {id: 3, uciSkillLevel: 20, searchDepth: 15, maxMovetimeMs: 800, multiPVCount: 3, pvProbabilities: [0.40, 0.30, 0.30], maxCentipawnDrop: 150, minFakeThinkTime: 0.9, maxFakeThinkTime: 1.1},
        {id: 4, uciSkillLevel: 20, searchDepth: 15, maxMovetimeMs: 1000, multiPVCount: 3, pvProbabilities: [0.40, 0.35, 0.25], maxCentipawnDrop: 100, minFakeThinkTime: 1.1, maxFakeThinkTime: 1.3},
        {id: 5, uciSkillLevel: 20, searchDepth: 15, maxMovetimeMs: 1000, multiPVCount: 3, pvProbabilities: [0.55, 0.3, 0.15], maxCentipawnDrop: 80, minFakeThinkTime: 1.1, maxFakeThinkTime: 1.3},
        {id: 6, uciSkillLevel: 20, searchDepth: 16, maxMovetimeMs: 1200, multiPVCount: 2, pvProbabilities: [0.65, 0.35], maxCentipawnDrop: 60, minFakeThinkTime: 1.3, maxFakeThinkTime: 1.5},
        {id: 7, uciSkillLevel: 20, searchDepth: 17, maxMovetimeMs: 1500, multiPVCount: 2, pvProbabilities: [0.75, 0.25], maxCentipawnDrop: 40, minFakeThinkTime: 1.6, maxFakeThinkTime: 1.8},
        {id: 8, uciSkillLevel: 20, searchDepth: 18, maxMovetimeMs: 1500, multiPVCount: 2, pvProbabilities: [0.85, 0.15], maxCentipawnDrop: 20, minFakeThinkTime: 1.6, maxFakeThinkTime: 1.8},
        {id: 9, uciSkillLevel: 20, searchDepth: 19, maxMovetimeMs: 2000, multiPVCount: 1, pvProbabilities: [1.0], maxCentipawnDrop: 0, minFakeThinkTime: 2.1, maxFakeThinkTime: 2.3},
        {id: 10, uciSkillLevel: 20, searchDepth: 25, maxMovetimeMs: 2500, multiPVCount: 1, pvProbabilities: [1.0], maxCentipawnDrop: 0, minFakeThinkTime: 2.6, maxFakeThinkTime: 2.8}
    ] 
};

// =====================================================================
// TÍNH NĂNG FEATURE DETECTION (NHẬN DIỆN PHẦN CỨNG)
// =====================================================================
function checkThreads() {
    try {
        console.log("Check Threads: typeof SharedArrayBuffer = ", typeof SharedArrayBuffer);
        return typeof SharedArrayBuffer !== 'undefined';
    } catch (e) {
        console.error("Check Threads Error:", e);
        return false;
    }
}

async function checkSIMD() {
    try {
        const simdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
        let res = await WebAssembly.validate(simdWasm);
        console.log("Check SIMD result:", res);
        return res;
    } catch (e) { 
        console.error("Check SIMD Error:", e);
        return false; 
    }
}

async function checkRelaxedSIMD() {
    try {
        const relaxedSimdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]);
        let res = await WebAssembly.validate(relaxedSimdWasm);
        console.log("Check Relaxed SIMD result:", res);
        return res;
    } catch (e) { 
        console.error("Check Relaxed SIMD Error:", e);
        return false; 
    }
}

async function getBestEngineType() {
    const tier = getDeviceTier();
    const threads = checkThreads();
    const simd = await checkSIMD();
    let relaxedSimd = false;

    if (tier === 'PC') {
        relaxedSimd = await checkRelaxedSIMD();
    }

    console.log(`Hardware detection: Tier=${tier}, Threads=${threads}, SIMD=${simd}, RelaxedSIMD=${relaxedSimd}`);

    // YÊU CẦU 1: Mobile < 6GB bắt buộc chạy single_simd hoặc single
    if (tier === 'MOBILE_LOW') {
        if (simd) return 'single_simd';
        return 'single';
    }

    if (threads) {
        if (relaxedSimd) return 'multi_simd_relaxed';
        if (simd) return 'multi_simd';
        return 'multi';
    } else {
        if (simd) return 'single_simd';
        return 'single';
    }
}

// =====================================================================
// KHỞI TẠO ĐỘNG CƠ: TÁCH LUỒNG THEO KIẾN TRÚC XIANGQIAI.COM
// =====================================================================
function applyEngineHardwareLimits(type) {
    const tier = getDeviceTier();
    const isSingle = type.includes('single') || tier === 'MOBILE_LOW'; 
    
    // 1. XỬ LÝ GIỚI HẠN LUỒNG (THREADS)
    const inputThreads = document.getElementById('input-threads');
    const descThreads = document.getElementById('desc-threads');
    let maxThreads = 1;
    
    if (!isSingle) {
        if (navigator.deviceMemory) {
            maxThreads = Math.max(1, Math.floor(navigator.deviceMemory / 2));
        } else if (navigator.hardwareConcurrency) {
            maxThreads = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2));
        }
        if (maxThreads > 16) maxThreads = 16;
    }

    if (inputThreads) {
        inputThreads.setAttribute('max', maxThreads);
        if (state.aiSettings.threads > maxThreads) {
            state.aiSettings.threads = maxThreads;
        }
        inputThreads.value = state.aiSettings.threads;
    }
    if (descThreads) {
        descThreads.innerText = isSingle ? `Tối đa: 1 luồng (Dành cho máy yếu)` : `Tối đa: ${maxThreads} luồng (Đã tối ưu theo RAM)`;
    }

    // --- CẤU HÌNH YÊU CẦU 3 & 4 (GIỚI HẠN VÀ MẶC ĐỊNH DEPTH / HASH) ---
    let maxHash, defaultHash, maxDepth, defaultDepth;
    if (tier === 'PC') {
        maxHash = 512; defaultHash = 128;
        maxDepth = 100; defaultDepth = 50;
    } else if (tier === 'MOBILE_HIGH') {
        maxHash = 512; defaultHash = 64;
        maxDepth = 60; defaultDepth = 30;
    } else { // MOBILE_LOW
        maxHash = 256; defaultHash = 32;
        maxDepth = 30; defaultDepth = 20;
    }

    // 2. XỬ LÝ BẢNG BĂM (HASH)
    const inputHash = document.getElementById('input-hash');
    if (inputHash) {
        inputHash.setAttribute('max', maxHash);
        if (!storage.getAnalysis() || !storage.getAnalysis().hash) {
            state.aiSettings.hash = defaultHash; 
        }
        if (state.aiSettings.hash > maxHash) state.aiSettings.hash = maxHash;
        inputHash.value = state.aiSettings.hash;
    }

    // 3. XỬ LÝ ĐỘ SÂU (DEPTH)
    const inputDepth = document.getElementById('input-depth');
    if (inputDepth) {
        inputDepth.setAttribute('max', maxDepth);
        if (!storage.getAnalysis() || !storage.getAnalysis().depth) {
            state.aiSettings.depth = defaultDepth; 
        }
        if (state.aiSettings.depth > maxDepth) state.aiSettings.depth = maxDepth;
        inputDepth.value = state.aiSettings.depth;
    }
    
    storage.saveAnalysis(state.aiSettings); 

    // 4. [THÊM MỚI] ẨN NÚT "ĐI NGAY" NẾU LÀ BẢN SINGLE
    const btnGoInstant = document.getElementById('btn-go-instant');
    if (btnGoInstant) {
        if (isSingle) {
            // Ẩn hoàn toàn khỏi thanh toolbar
            btnGoInstant.style.display = 'none'; 
        } else {
            // Trả lại hiển thị mặc định. Các class như hide-on-vsbot 
            // có chứa !important trong CSS nên sẽ không bị xung đột.
            btnGoInstant.style.display = ''; // Sửa btn thành btnGoInstant
        }
    }
}

export async function initPikafish(forceType = null) {
    const type = forceType || await getBestEngineType();
    currentWasmType = type;
    console.log("🚀 Bắt đầu Khởi tạo Pikafish phiên bản:", type);

    // KÍCH HOẠT GIỚI HẠN UI NGAY TẠI ĐÂY
    applyEngineHardwareLimits(type);

    // Kích hoạt lưới an toàn bắt lỗi iOS
    attachCrashHandlers();

    const basePath = window.location.href.replace(/\/[^\/]*$/, '');
    console.log("Base Path:", basePath);

    // -----------------------------------------------------------------
    // PHÂN LUỒNG 1: BẢN MULTI (DÙNG <SCRIPT> TẢI TRỰC TIẾP LÊN MAIN THREAD)
    // -----------------------------------------------------------------
    if (type.includes("multi")) {
        const scriptUrl = `${basePath}/engines/${type}/pikafish.js`;
        console.log("Tải file script Multi tại:", scriptUrl);
        
        // Tạo thẻ script để tải module
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.onload = () => {
            console.log("Script Multi đã tải xong, đang gọi window.Pikafish()");
            // Khi file JS tải xong, hàm Pikafish() sẽ khả dụng ở window
            window.Pikafish({
                locateFile: function(path) {
                    let finalPath = path.endsWith('.data') ? `${basePath}/engines/${path}` : `${basePath}/engines/${type}/${path}`;
                    console.log("LocateFile request:", path, "->", finalPath);
                    return finalPath;
                },
                onReceiveStdout: function(text) { handleEngineOutput(text); },
                print: function(text) { handleEngineOutput(text); },
                ALLOW_MEMORY_GROWTH: true
            }).then(function(module) {
                console.log("Module Pikafish Multi khởi tạo THÀNH CÔNG!");
                currentEngineInstance = module;
                state.engineModule = {
                    sendCommand: (cmd) => {
                        if (typeof module.send_command === 'function') module.send_command(cmd);
                        else if (typeof module.sendCommand === 'function') module.sendCommand(cmd);
                    }
                };
                onEngineReady(type);
            }).catch(err => onEngineError("Lỗi Promise Pikafish() Multi: " + err));
        };
        script.onerror = (e) => onEngineError("Lỗi onload thẻ script: Không thể tải " + scriptUrl);
        document.head.appendChild(script);
    } 
    
    // -----------------------------------------------------------------
    // PHÂN LUỒNG 2: BẢN SINGLE (DÙNG BASE64 WORKER ĐỂ LÁCH CORS TRÊN ZALO/FB)
    // -----------------------------------------------------------------
    else {
        console.log("Chuẩn bị tạo Base64 Worker cho bản Single...");
        // Viết code worker thuần túy dạng Text
        const workerScript = `
            var EngineInstance = null;
            self.onmessage = function (e) {
                if (e.data.command != null) {
                    if(EngineInstance && typeof EngineInstance.send_command === 'function') EngineInstance.send_command(e.data.command);
                    else if(EngineInstance && typeof EngineInstance.sendCommand === 'function') EngineInstance.sendCommand(e.data.command);
                } else if (e.data.wasm_type != null) {
                    let wasmType = e.data.wasm_type;
                    let basePath = e.data.basePath;
                    let scriptToLoad = basePath + "/engines/" + wasmType + "/pikafish.js";
                    
                    self.postMessage({ debug: "Worker bắt đầu gọi importScripts: " + scriptToLoad });
                    
                    try {
                        self.importScripts(scriptToLoad);
                        self.postMessage({ debug: "Worker importScripts thành công!" });
                    } catch(err) {
                        self.postMessage({ error: "Lỗi importScripts trong Worker: " + err.toString() });
                        return;
                    }
                    
                    self['Pikafish']({
                        onReceiveStdout: (text) => self.postMessage({ stdout: text }),
                        print: (text) => self.postMessage({ stdout: text }),
                        locateFile: (url) => {
                            if (url === 'pikafish.data') return basePath + "/engines/" + url;
                            return basePath + "/engines/" + wasmType + "/" + url;
                        }
                    }).then(p => {
                        EngineInstance = p;
                        self.postMessage({ ready: true });
                    }).catch(err => {
                        self.postMessage({ error: "Lỗi Promise Pikafish() trong Worker: " + err.toString() });
                    });
                }
            }
        `;

        try {
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            
            console.log("Blob URL tạo thành công. Khởi tạo new Worker...");
            const engineWorker = new Worker(blobUrl, { type: "classic" });
            
            URL.revokeObjectURL(blobUrl);

            // [THÊM MỚI] Bắt lỗi file worker bị crash
            engineWorker.onerror = (err) => {
                console.error("Worker Object Error (Main Thread bắt được):", err.message || err);
                onEngineError("Worker Object Error: " + (err.message || err));
            };

            currentEngineInstance = engineWorker;

            // Xử lý Gửi lệnh (Giả lập interface)
            state.engineModule = {
                sendCommand: (cmd) => {
                    engineWorker.postMessage({ command: cmd });
                }
            };

            // Lắng nghe kết quả từ Worker
            engineWorker.onmessage = (e) => {
                if (e.data.debug) {
                    console.log("[Worker Debug]:", e.data.debug);
                } else if (e.data.error) {
                    console.error("[Worker Error Bắn về]:", e.data.error);
                    onEngineError(e.data.error);
                } else if (e.data.ready) {
                    console.log("Worker gửi tín hiệu READY!");
                    onEngineReady(type);
                } else if (e.data.stdout) {
                    handleEngineOutput(e.data.stdout);
                }
            };

            // Gửi lệnh khởi tạo
            console.log("Gửi lệnh init tới Worker...");
            engineWorker.postMessage({ wasm_type: type, basePath: basePath });
        } catch (e) {
            console.error("Lỗi bao ngoài khi khởi tạo Single Worker:", e);
            onEngineError("Lỗi khởi tạo Worker: " + e.toString());
        }
    }
}

// Hàm gọi khi Engine load thành công
function onEngineReady(type) {
    state.engineModule.sendCommand("uci");
    state.engineModule.sendCommand("isready");
    
    // Tắt giao diện Loading Overlay
    const overlay = document.getElementById('loading-overlay');
    if (overlay) { 
        overlay.style.opacity = '0'; 
        setTimeout(() => { overlay.style.display = 'none'; }, 500); 
    }

    // NẾU CÓ LỆNH ĐANG CHỜ DO VỪA BỊ "KILL & RESTART"
    if (pendingAction) {
        // Nạp setting tĩnh và chạy tiếp lệnh
        if (state.appMode !== 'vsbot') {
            state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
        }
        executePendingAction();
    } else {
        applyEngineSettings(); 
        showToast(`✅ Tải AI thành công (Bản: ${type})`);
    }
}

// Hàm gọi khi Engine load lỗi
function onEngineError(err) {
    console.error("Lỗi khởi tạo AI (Hàm onEngineError):", err);
    const overlay = document.getElementById('loading-overlay');
    if(overlay) overlay.innerHTML = `<h2 style='color:red; text-align:center;'>Lỗi tải Engine AI</h2><p style='text-align:center;'>${err.toString()}</p>`;
}
export function selectHumanLikeMove(parsedMultiPVList, currentLevelData) {
    if (!parsedMultiPVList || parsedMultiPVList.length === 0) return null;
    const pv1 = parsedMultiPVList[0];
    if (pv1.isMate || parsedMultiPVList.some(pv => pv.isMate)) {
        return { selectedMove: pv1.move, fakeDelayMs: getRandomDelay(0.5, 1.5) };
    }
    const probs = currentLevelData.pvProbabilities;
    let roll = Math.random(); let cumulative = 0.0; let selectedIndex = 0;
    for (let i = 0; i < probs.length; i++) {
        cumulative += probs[i];
        if (roll <= cumulative) { selectedIndex = i; break; }
    }
    if (selectedIndex >= parsedMultiPVList.length) selectedIndex = parsedMultiPVList.length - 1;
    let selectedPv = parsedMultiPVList[selectedIndex];
    const cpDrop = pv1.cp - selectedPv.cp; 
    if (cpDrop > currentLevelData.maxCentipawnDrop) selectedPv = pv1; 
    return { selectedMove: selectedPv.move, fakeDelayMs: getRandomDelay(currentLevelData.minFakeThinkTime, currentLevelData.maxFakeThinkTime) };
}

function getRandomDelay(minSeconds, maxSeconds) {
    const minMs = minSeconds * 1000; const maxMs = maxSeconds * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
}

export function applyEngineSettings() {
    if (!state.engineModule) return;
    pendingAction = 'eval';
    handleStateTransition(); 
}

let currentCloudFetchId = 0;
export function fetchCloudBook(fen) {
    const isRedTurn = fen.split(" ")[1] === "w";
    const isAITurn = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

    // Xử lý khi mất mạng hoàn toàn (Offline)
    if (!navigator.onLine) {
        if (isAITurn) setTimeout(() => triggerEngineOnly(), 10);
        return; 
    }
    
    const fetchId = ++currentCloudFetchId;
    const container = document.getElementById('cloudbook-list-container');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Đang tải dữ liệu...</div>';
    let shortFen = fen.split(" ").slice(0, 2).join(" ");
    let url = `https://www.chessdb.cn/chessdb.php?action=queryall&board=${encodeURIComponent(shortFen)}`;
    
    // TẠO ABORT CONTROLLER (Ép timeout ngắt kết nối sau 2 giây nếu server nghẽn)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    fetch(url, { signal: controller.signal }).then(res => {
        clearTimeout(timeoutId); // Xóa bộ đếm nếu server trả lời sớm
        return res.text();
    }).then(text => {
        if (fetchId !== currentCloudFetchId) return;
        
        const currentRoundNum = parseInt(fen.split(" ")[5]) || 1;
        let effectiveCloudLimit = state.appMode === 'vsbot' ? 1 : state.appSettings.cloudBookLimit;
        const canUseCloudBook = state.appSettings.cloudBookEnabled && (currentRoundNum <= effectiveCloudLimit);
        let isValidCloudData = text && !text.includes("unknown") && !text.includes("invalid") && !text.includes("checkmate") && !text.includes("stalemate");

        // TRƯỜNG HỢP 1: Lượt máy đi VÀ Cloud Book CÓ sách
        if (isAITurn && canUseCloudBook && isValidCloudData) {
            let moves = text.split('|');
            let firstMoveData = moves[0].split(',');
            let moveObj = {};
            firstMoveData.forEach(p => { let [k, v] = p.split(':'); moveObj[k] = v; });
            
            if (moveObj.move && getStrictLegalMoves(state.currentSituation, state.currentNode.fen).includes(moveObj.move)) {
                let delayMs = state.appMode !== 'vsbot' ? (state.aiSettings.moveTime || 1) * 1000 : 1000;
                showAILoading();
                
                clearTimeout(cloudBookTimeoutId);
                cloudBookTimeoutId = setTimeout(() => { 
                    const isRedTurnNow = state.currentNode.fen.split(" ")[1] === "w";
                    const willAIOperate = (isRedTurnNow && state.aiPlaysRed) || (!isRedTurnNow && state.aiPlaysBlack);
                    if (willAIOperate) {
                        hideAILoading();
                        executeMove(moveObj.move); 
                    } else {
                        hideAILoading();
                    }
                }, delayMs); 
                return;
            }
        }

        // TRƯỜNG HỢP 2: Nếu là lượt Máy đi nhưng HẾT SÁCH (hoặc cờ lạ) -> Mở khóa cho Pikafish tự nghĩ
        if (isAITurn) triggerEngineOnly();

        // HIỂN THỊ DANH SÁCH LÊN UI
        if (!isValidCloudData) {
            container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Không có dữ liệu khai cuộc</div>';
            return;
        }
        
        let moves = text.split('|'); container.innerHTML = ''; let hasValidMove = false;
        let headerBtn = document.createElement('div'); headerBtn.className = 'cloud-btn cloud-header';
        let spanHeaderMove = document.createElement('span'); spanHeaderMove.innerText = 'Nước Đi';
        let spanHeaderScore = document.createElement('span'); spanHeaderScore.innerText = isRedTurn ? 'Điểm Bên Đỏ' : 'Điểm Bên Đen';
        headerBtn.appendChild(spanHeaderMove); headerBtn.appendChild(spanHeaderScore); container.appendChild(headerBtn);
        
        moves.forEach(mStr => {
            let parts = mStr.split(','); let moveObj = {};
            parts.forEach(p => { let [k, v] = p.split(':'); moveObj[k] = v; });
            if (moveObj.move) {
                hasValidMove = true; let isPositive = true; let scoreText = "0";
                if (moveObj.score !== undefined) {
                    let score = parseInt(moveObj.score); isPositive = score >= 0; scoreText = (isPositive ? '+' : '') + score;
                } else if (moveObj.winrate !== undefined) {
                    let wr = parseFloat(moveObj.winrate); isPositive = wr >= 50.0; scoreText = `${wr}%`; 
                }
                let notation = customTranslator(moveObj.move, fen) || moveObj.move;
                let btn = document.createElement('button'); btn.className = `cloud-btn ${isPositive ? 'cloud-blue' : 'cloud-red'}`;
                let spanMove = document.createElement('span'); spanMove.innerText = notation;
                let spanScore = document.createElement('span'); spanScore.innerText = scoreText;
                btn.appendChild(spanMove); btn.appendChild(spanScore);
                btn.onclick = () => {
                    if (getStrictLegalMoves(state.currentSituation, state.currentNode.fen).includes(moveObj.move)) { executeMove(moveObj.move); } 
                    else { showToast("⚠️ Nước đi này bị cấm do luật lặp lại!"); }
                };
                container.appendChild(btn);
            }
        });
        if (!hasValidMove) container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Không có dữ liệu khai cuộc</div>';
        
    }).catch(err => {
        // TRƯỜNG HỢP 3: CÁP QUANG ĐỨT / SERVER LỖI -> HẾT 2 GIÂY SẼ BỊ NÉM VÀO ĐÂY
        if (fetchId !== currentCloudFetchId) return;
        container.innerHTML = '<div style="text-align: center; color: #d32f2f; margin-top: 10px;">Lỗi kết nối máy chủ CloudDB</div>';
        
        // Giải thoát cho Bot nếu nó đang phải chờ
        if (isAITurn) triggerEngineOnly();
    });
}

export function triggerEngineEvaluation() {
    if (!state.engineModule || state.isEditMode) return;
    pendingAction = 'eval';
    handleStateTransition();
}

export function triggerHintEvaluation() {
    if (!state.engineModule || state.isAnimating || state.isAutoPlaying) return;
    pendingAction = 'hint';
    handleStateTransition();
}

export function triggerAnalyzeOnly() {
    if (!state.engineModule || state.isAnimating || state.isAutoPlaying) return;
    pendingAction = 'analyze';
    handleStateTransition();
}

function handleStateTransition() {
    clearTimeout(cloudBookTimeoutId); 
    
    if (isEngineSearching) {
        // KIỂM TRA NẾU ĐANG CHẠY SINGLE THREAD TRÊN WORKER
        if (currentEngineInstance instanceof Worker) {
            console.log("Single-thread bị block, đang tiêu diệt và hồi sinh Worker...");
            currentEngineInstance.terminate(); // Giết Worker cũ
            currentEngineInstance = null;
            state.engineModule = null;
            isEngineSearching = false;
            
            // Khởi tạo lại Worker mới (Hàm onEngineReady sẽ tự gọi executePendingAction khi xong)
            initPikafish(currentWasmType);
        } else {
            // ĐA LUỒNG XỬ LÝ BÌNH THƯỜNG
            state.engineModule.sendCommand("stop");
            clearTimeout(stopTimeoutId);
            stopTimeoutId = setTimeout(() => {
                if (pendingAction) {
                    isEngineSearching = false;
                    executePendingAction();
                }
            }, 150);
        }
    } else {
        executePendingAction();
    }
}

function executePendingAction() {
    const action = pendingAction;
    pendingAction = null; 
    clearTimeout(stopTimeoutId); 

    setTimeout(() => {
        if (action === 'eval') {
            const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
            const willAIPlay = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

            // NẾU CHỈ LÀ PHÂN TÍCH (Không phải lượt Máy tự đi)
            // -> Bật Pikafish tính toán NGAY LẬP TỨC, không cần đợi Cloud Book!
            if (!willAIPlay && state.isAnalyzing) {
                triggerEngineOnly();
            }

            // Gọi Cloud Book chạy ngầm (Nó sẽ tự update UI lúc tải xong)
            fetchCloudBook(state.currentNode.fen);
        }
        else if (action === 'hint') {
            const style = state.vsBotSettings.botStyle;
            let profile = (style === 'human') ? botProfiles.human[9] : botProfiles.standard[9];

            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value 1`); 
            state.pvLines = []; clearArrow(); renderMultiPVList();

            state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
            isEngineSearching = true; 
        }
        else if (action === 'analyze') {
            state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
            state.pvLines = []; clearArrow(); renderMultiPVList();

            state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
            
            // YÊU CẦU 2: Giới hạn Depth của nút Phân Tích
            const tier = getDeviceTier();
            let analyzeDepth = 100;
            if (tier === 'MOBILE_HIGH') analyzeDepth = 60;
            else if (tier === 'MOBILE_LOW') analyzeDepth = 30;
            
            state.engineModule.sendCommand(`go depth ${analyzeDepth}`);
            isEngineSearching = true; 
        }
        // THÊM MỚI HÀNH ĐỘNG GO_INSTANT
        else if (action === 'go_instant') {
            state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`); 
            state.engineModule.sendCommand("go movetime 100"); 
            isEngineSearching = true;
        }
    }, 10);
}

function triggerEngineOnly() {
    if (!state.engineModule || state.isAnimating || state.isEditMode || state.isAutoPlaying) return;
    const strictMoves = getStrictLegalMoves(state.currentSituation, state.currentNode.fen);
    if (strictMoves.length === 0) return;

    if (state.appMode !== 'vsbot') {
        state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
        state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
    }

    state.pvLines = []; clearArrow(); renderMultiPVList();

    state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
    
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    const willAIPlay = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

    if (state.appMode === 'vsbot' && willAIPlay) {
        const style = state.vsBotSettings.botStyle;
        const levelIdx = state.vsBotSettings.level - 1;
        let profile;
        if (style === 'human') {
            profile = botProfiles.human[levelIdx];
            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${profile.multiPVCount}`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
        } else {
            profile = botProfiles.standard[levelIdx];
            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value 1`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
        }
        isEngineSearching = true; 
        showAILoading(); 
    } 
    else {
        if (willAIPlay) {
            const moveTimeMs = Math.floor(state.aiSettings.moveTime * 1000);
            state.engineModule.sendCommand(`go depth ${state.aiSettings.depth} movetime ${moveTimeMs}`);
            isEngineSearching = true; 
            showAILoading(); 
        } else if (state.isAnalyzing) {
            const tier = getDeviceTier();
            let analyzeDepth = 100;
            if (tier === 'MOBILE_HIGH') analyzeDepth = 60;
            else if (tier === 'MOBILE_LOW') analyzeDepth = 30;
            
            state.engineModule.sendCommand(`go depth ${analyzeDepth}`);
            isEngineSearching = true; 
        }
    }
}

function renderMultiPVList() {
    const container = document.getElementById("multipv-list-container");
    if (!container) return;
    if (state.pvLines.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Chưa có dữ liệu phân tích</div>';
        return;
    }
    let html = ''; const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    const colorText = isRedTurn ? "Điểm Đỏ" : "Điểm Đen";
    state.pvLines.forEach(line => {
        if (!line) return;
        const notation = customTranslator(line.bestMove, state.currentNode.fen) || line.bestMove;
        let npsStr = line.nps ? line.nps.toLocaleString() : "0";
        let timeStr = line.time ? (line.time / 1000).toFixed(1) + "s" : "0.0s";
        let scoreStr = line.scoreText || "0";
        let blockColor = (line.relativeScore >= 0) ? "#1a73e8" : "#d32f2f";
        html += `
            <div class="multipv-item" style="color: ${blockColor};">
                <div class="multipv-header">
                    <span>Biến số ${line.rank}</span>
                    <span class="multipv-bestmove">${notation}</span>
                </div>
                <div class="multipv-details" style="color: inherit;">
                    <span>${colorText}: <strong>${scoreStr}</strong></span>
                    <span>Độ sâu: ${line.depth || 0}</span>
                </div>
                <div class="multipv-details" style="color: inherit;">
                    <span>Thời gian: ${timeStr}</span>
                    <span>NPS: ${npsStr}</span>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

export function handleEngineOutput(text) {
    if (text.startsWith("info depth")) {
        const depthMatch = text.match(/depth (\d+)/);
        const scoreCpMatch = text.match(/score cp (-?\d+)/);
        const scoreMateMatch = text.match(/score mate (-?\d+)/);
        const timeMatch = text.match(/time (\d+)/);
        const npsMatch = text.match(/nps (\d+)/);
        const multipvMatch = text.match(/multipv (\d+)/);
        const pvMatch = text.match(/ pv ([a-i][0-9][a-i][0-9])(?: ([a-i][0-9][a-i][0-9]))?/);
        
        let rank = multipvMatch ? parseInt(multipvMatch[1]) : 1;
        let isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
        let turnPrefix = isRedTurn ? "Điểm Đỏ: " : "Điểm Đen: "; 
        let scoreText = "0"; let finalScoreForBar = 0; let relativeScore = 0;    

        if (scoreCpMatch) {
            let cp = parseInt(scoreCpMatch[1]); relativeScore = cp; 
            scoreText = (relativeScore > 0 ? "+" : "") + relativeScore;
            if (relativeScore === 0) scoreText = "0";
            finalScoreForBar = isRedTurn ? cp : -cp;
            if (rank === 1) {
                let winRate = 50 + (finalScoreForBar / 20); 
                if (winRate > 100) winRate = 100; if (winRate < 0) winRate = 0;
                const scoreBarFill = document.getElementById("score-bar-fill");
                if (scoreBarFill) scoreBarFill.style.width = `${winRate}%`;
                const scoreTextEl = document.getElementById("score-text");
                if (scoreTextEl) scoreTextEl.innerText = turnPrefix + scoreText;
            }
        } 
        else if (scoreMateMatch) {
            let mate = parseInt(scoreMateMatch[1]); relativeScore = mate > 0 ? 10000 : -10000;
            scoreText = `chiếu hết(${mate > 0 ? '+' : '-'}${Math.abs(mate)})`;
            if (rank === 1) {
                let isRedWin = (isRedTurn && mate > 0) || (!isRedTurn && mate < 0);
                const scoreBarFill = document.getElementById("score-bar-fill");
                if (scoreBarFill) scoreBarFill.style.width = isRedWin ? `100%` : `0%`;
                const scoreTextEl = document.getElementById("score-text");
                if (scoreTextEl) scoreTextEl.innerText = turnPrefix + scoreText;
            }
        }
        if (pvMatch) {
            state.pvLines[rank - 1] = {
                rank: rank, bestMove: pvMatch[1], ponderMove: pvMatch[2] || null,
                scoreText: scoreText, relativeScore: relativeScore, 
                depth: depthMatch ? parseInt(depthMatch[1]) : 0, time: timeMatch ? parseInt(timeMatch[1]) : 0, nps: npsMatch ? parseInt(npsMatch[1]) : 0
            };
            const now = Date.now();
            if (now - lastUiUpdateTime > 100) {
                renderMultiPVList(); 
                drawBestMoveArrow();
                lastUiUpdateTime = now;
            }
        }
    } 
    
    else if (text.startsWith("bestmove")) {
        isEngineSearching = false;

        renderMultiPVList();
        drawBestMoveArrow();

        if (pendingAction) {
            executePendingAction();
            return; 
        }

        if (state.isAutoPlaying || state.isAnimating) return;
        const parts = text.split(" "); 
        const bestMove = parts[1] ? parts[1].trim() : "";
        
        if (bestMove === '(none)' || bestMove === 'none' || bestMove === '') {
            state.pvLines = []; clearArrow(); renderMultiPVList(); 
            hideAILoading();
            return;
        }

        const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
        
        if (state.appMode === 'vsbot' && !((isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack))) {
            state.pendingAIMove = bestMove; 
            hideAILoading();
            return;
        }

        if ((isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack)) {
            if (state.appMode === 'vsbot' && state.vsBotSettings.botStyle === 'human') {
                const levelIdx = state.vsBotSettings.level - 1;
                const currentLevelData = botProfiles.human[levelIdx];
                let parsedMultiPVList = state.pvLines.filter(p => p).map(p => ({
                    move: p.bestMove, cp: p.relativeScore, isMate: p.scoreText.includes('chiếu hết')
                }));
                parsedMultiPVList.sort((a, b) => b.cp - a.cp);
                const result = selectHumanLikeMove(parsedMultiPVList, currentLevelData);

                if (result) {
                    setTimeout(() => { 
                        state.pendingAIMove = result.selectedMove; 
                        hideAILoading();
                    }, result.fakeDelayMs);
                } else {
                    state.pendingAIMove = bestMove; 
                    hideAILoading();
                }
            } else {
                state.pendingAIMove = bestMove;
                hideAILoading();
            }
        } else {
            hideAILoading();
        }
    }
}

// =====================================================================
// HỆ THỐNG CỨU HỘ: CHỐNG CRASH TRÊN IOS VÀ WEBVIEW (ZALO/FB/TIKTOK)
// =====================================================================
function attachCrashHandlers() {
    window.addEventListener('error', handleEngineCrash);
    window.addEventListener('unhandledrejection', handleEngineCrash);
}

function handleEngineCrash(e) {
    const msg = (e?.error?.message) || (e?.reason?.message) || String(e?.reason || "");
    if (msg.includes("Out of bounds memory access") || msg.includes("memory access out of bounds")) {
        fallbackToSingleThread(msg);
    }
}

function fallbackToSingleThread(reason) {
    // Nếu đã fallback rồi hoặc đang ở single rồi thì thôi
    if (fallbackTriggered || !currentWasmType || !currentWasmType.includes("multi")) return;
    
    fallbackTriggered = true;
    console.warn("🔥 Trình duyệt sập bộ nhớ do đa luồng. Kích hoạt Cứu Hộ (Fallback) về Đơn luồng!", reason);
    showToast("⚠️ Trình duyệt cạn RAM! Đang tự động chuyển về chế độ An toàn...");

    // 1. Tiêu diệt Engine đang chạy
    try {
        if (currentEngineInstance && typeof currentEngineInstance.terminate === 'function') {
            currentEngineInstance.terminate();
        }
    } catch (err) { console.warn("Lỗi khi kill engine", err); }

    currentEngineInstance = null;
    state.engineModule = null;

    // 2. Chuyển đổi định dạng (Từ multi -> single)
    let newType = "single";
    if (currentWasmType.includes("simd")) newType = "single_simd";

    // 3. Khởi động lại hệ thống
    setTimeout(() => {
        initPikafish(newType);
    }, 500);
}

// Dành cho nút Đi Ngay
export function triggerGoInstant() {
    if (!state.engineModule) return;
    pendingAction = 'go_instant';
    handleStateTransition(); // Sẽ tự động Kill Worker nếu cần
}

// Dành cho việc cưỡng chế dừng AI
export function forceStopEngine() {
    if (!state.engineModule || !isEngineSearching) return;
    pendingAction = null; // Hủy mọi lệnh chờ
    
    if (currentEngineInstance instanceof Worker) {
        currentEngineInstance.terminate();
        currentEngineInstance = null;
        state.engineModule = null;
        isEngineSearching = false;
        initPikafish(currentWasmType); // Hồi sinh để chờ lệnh mới
    } else {
        state.engineModule.sendCommand("stop");
        isEngineSearching = false;
    }
}