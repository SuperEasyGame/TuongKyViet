// js/board.js
import { state } from './state.js';
import { PIECE_MAP } from './config.js';
import { openModal } from './ui.js';
import { toggleAutoPlay, forceStopAIPlayers, jumpToNode, getMainLine, ensureNodeData } from './game.js';
import { handleEditSquareClick } from './editor.js';
import { handleSquareClick } from './game.js';

export const imageCache = {}; 
export let isImagesLoaded = false;

// Đổi từ let sang export function để lấy State mới nhất
let currentBoardPath = "style/1-mac_dinh";
let currentPiecePath = "style/1-mac_dinh";

const SHADOW_SCALE = 1.0;         // Kích thước bóng (1.05 = to hơn quân cờ 5%)
const SHADOW_OFFSET_X_PCT = 0.05;  // Lệch sang phải 4% khi nằm im
const SHADOW_OFFSET_Y_PCT = 0.1;  // Lệch xuống dưới 6% khi nằm im

const SELECTION_SCALE = 1.55;      // Ánh sáng dưới đáy quân cờ đang chọn (selection.webp)
const DOT_SCALE = 0.25;            // Chấm xanh nước đi hợp lệ & ăn quân (dot.webp)
const FROM_SCALE = 0.4;            // Điểm xuất phát nước đi trước (from.webp)
const TO_SCALE = 1.1;             // Điểm đến nước đi trước (to.webp)
 
// Tải ảnh lên RAM
export function preloadImages() {
    return new Promise((resolve) => {
        // Cập nhật path từ State
        const boardPath = state.appSettings.boardStyle || "style/1-mac_dinh";
        const piecePath = state.appSettings.pieceStyle || "style/1-mac_dinh";
        
        const boardArea = document.getElementById('chess-board-area');
        if (boardArea) {
            boardArea.style.backgroundImage = `url('${boardPath}/board.webp')`;
            boardArea.style.setProperty('--bg-image', `url('${boardPath}/board.webp')`);
        }

        document.querySelectorAll('.piece-palette img').forEach(imgTag => {
            const pieceCode = imgTag.dataset.piece;
            if (pieceCode) {
                imgTag.src = `${piecePath}/${PIECE_MAP[pieceCode]}.webp`;
            }
        });

        const pieceKeys = Object.keys(PIECE_MAP);
        const extraImages = ['shadow', 'dot', 'from', 'to', 'selection']; // ĐÃ RÚT board VÀ blind RA
        const blindPieces = ['blind_b', 'blind_w']; 
        
        let loadedCount = 0;
        const totalImages = pieceKeys.length + extraImages.length + blindPieces.length + 1; // +1 cho Board

        const checkDone = () => {
            loadedCount++;
            if (loadedCount === totalImages) {
                isImagesLoaded = true;
                resolve();
            }
        };

        // Tải ảnh Bàn Cờ vào RAM
        const imgBoard = new Image();
        imgBoard.src = `${boardPath}/board.webp`;
        imgBoard.onload = () => { imageCache['board'] = imgBoard; checkDone(); };
        imgBoard.onerror = () => { checkDone(); };
        
        // Tải ảnh UI (bóng, chấm...)
        extraImages.forEach(imgName => {
            const img = new Image();
            img.src = `style/${imgName}.webp`;
            img.onload = () => { imageCache[imgName] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });
        
        // Tải ảnh Mù
        blindPieces.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${key}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });

        // Tải ảnh Quân Cờ
        pieceKeys.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${PIECE_MAP[key]}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });
    });
}
// HÀM TẢI LẠI RIÊNG BÀN CỜ (Dùng cho Setting)
export function reloadBoardImage(boardPath) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `${boardPath}/board.webp`;
        img.onload = () => { 
            imageCache['board'] = img; 
            
            // Cập nhật cả thẻ Div chứa bàn cờ để đồng bộ ảnh
            const boardArea = document.getElementById('chess-board-area');
            if (boardArea) {
                boardArea.style.backgroundImage = `url('${img.src}')`;
                // Nếu bạn dùng Pseudo-element (::before) như trong CSS cũ thì phải gán bằng Custom Property
                boardArea.style.setProperty('--bg-image', `url('${img.src}')`);
            }
            resolve(); 
        };
        img.onerror = () => { console.error(`Lỗi tải ảnh bàn cờ: ${img.src}`); resolve(); };
    });
}

// HÀM TẢI LẠI RIÊNG QUÂN CỜ (Dùng cho Setting)
export function reloadPieceImages(piecePath) {
    return new Promise((resolve) => {
        const pieceKeys = Object.keys(PIECE_MAP);
        const extraPieces = ['blind_b', 'blind_w']; // Thêm 2 quân mù
        
        let loadedCount = 0;
        const totalImages = pieceKeys.length + extraPieces.length; 

        const checkDone = () => {
            loadedCount++;
            if (loadedCount === totalImages) resolve();
        };

        // Tải lại quân mù
        extraPieces.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${key}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { console.error(`Lỗi tải: ${img.src}`); checkDone(); };
        });

        // Tải lại toàn bộ 14 quân cờ bình thường
        pieceKeys.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${PIECE_MAP[key]}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { console.error(`Lỗi tải: ${img.src}`); checkDone(); };
        });
        
        // ĐỒNG BỘ LUÔN KHAY XẾP QUÂN DƯỚI DOM (Editor)
        document.querySelectorAll('.piece-palette img').forEach(imgTag => {
            const pieceCode = imgTag.dataset.piece;
            if (pieceCode) {
                imgTag.src = `${piecePath}/${PIECE_MAP[pieceCode]}.webp`;
            }
        });
    });
}
// ==========================================
// HỆ THỐNG CANVAS RENDER ENGINE (60 FPS & ANIMATION)
// ==========================================
let canvas, ctx;
let boardRect = { width: 0, height: 0 };
let pieceSize = 0;
let isRenderLoopRunning = false;

let isPointerDown = false;
let dragStartLogic = null;
let currentDragLogic = null;
let preventClick = false;

export let animState = null;

// Hàm kích hoạt Animation trượt cờ
export function startCanvasAnimation(fromIccs, toIccs, pieceCode) {
    // TÍNH TOÁN SẴN TỌA ĐỘ PIXEL NGAY TỪ ĐẦU (Chống rác bộ nhớ)
    const fromXY = vschess.i2b[fromIccs];
    const toXY = vschess.i2b[toIccs];
    const pStart = getCanvasCoords(fromXY % 9, Math.floor(fromXY / 9));
    const pEnd = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

    animState = {
        from: fromIccs,
        to: toIccs,
        piece: pieceCode,
        startX: pStart.cx,
        startY: pStart.cy,
        endX: pEnd.cx,
        endY: pEnd.cy,
        startTime: performance.now(),
        duration: 150 // Thời gian trượt 150ms
    };
}

export function initCanvas() {
    canvas = document.getElementById('chess-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d', { alpha: true }); 
    
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));
    
    resizeCanvas();
    
    // BẮT SỰ KIỆN KÉO THẢ VẼ MŨI TÊN (Hỗ trợ cả Chuột và Cảm ứng)
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    
    canvas.addEventListener('click', (e) => {
        if (preventClick) {
            preventClick = false;
            return;
        }
        handleCanvasClick(e);
    });
    
    if (!isRenderLoopRunning) {
        isRenderLoopRunning = true;
        requestAnimationFrame(renderLoop);
    }
}

function resizeCanvas() {
    if (!canvas) return;
    const parent = document.getElementById('chess-board-area');
    const trueWidth = parent.offsetWidth;
    const trueHeight = parent.offsetHeight;
    boardRect = { width: trueWidth, height: trueHeight };
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = trueWidth * dpr;
    canvas.height = trueHeight * dpr;
    canvas.style.width = `100%`;
    canvas.style.height = `100%`;
    ctx.scale(dpr, dpr);
    pieceSize = trueWidth * 0.1; 
}

// Hàm tính tọa độ Logic (0-8, 0-9) từ Event Chuột/Cảm ứng
function getLogicPosFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const percentX = (event.clientX - rect.left) / rect.width;
    const percentY = (event.clientY - rect.top) / rect.height;

    const paddingXPercent = 0.07;
    const paddingYPercent = 0.065;
    const gridWidthPercent = 1 - (paddingXPercent * 2);
    const gridHeightPercent = 1 - (paddingYPercent * 2);
    const cellXPercent = gridWidthPercent / 8;
    const cellYPercent = gridHeightPercent / 9;

    let logicX = Math.round((percentX - paddingXPercent) / cellXPercent);
    let logicY = Math.round((percentY - paddingYPercent) / cellYPercent);

    if (state.isBoardFlipped) {
        logicX = 8 - logicX;
        logicY = 9 - logicY;
    }
    return { logicX, logicY };
}

// --- LOGIC KÉO THẢ MŨI TÊN ---
function handlePointerDown(e) {
    if (state.isEditMode || state.isChartRunning || state.isChartDrawing) return;
    if (state.selectedSquare !== null) return; // Không cho vẽ khi đang click chọn quân

    const { logicX, logicY } = getLogicPosFromEvent(e);
    if (logicX < 0 || logicX > 8 || logicY < 0 || logicY > 9) return;
    
    canvas.setPointerCapture(e.pointerId);
    isPointerDown = true;
    dragStartLogic = { x: logicX, y: logicY };
    currentDragLogic = null;
    preventClick = false;
}

function handlePointerMove(e) {
    if (!isPointerDown) return;
    const { logicX, logicY } = getLogicPosFromEvent(e);
    if (logicX < 0 || logicX > 8 || logicY < 0 || logicY > 9) return;

    if (logicX !== dragStartLogic.x || logicY !== dragStartLogic.y) {
        currentDragLogic = { x: logicX, y: logicY };
        preventClick = true; // Đánh dấu đã kéo thả, sẽ không tính là lệnh Click chọn quân
    } else {
        currentDragLogic = null;
    }
}

function handlePointerUp(e) {
    if (!isPointerDown) return;
    isPointerDown = false;
    canvas.releasePointerCapture(e.pointerId);
    
    if (currentDragLogic) {
        const fromIccs = vschess.b2i[dragStartLogic.y * 9 + dragStartLogic.x];
        const toIccs = vschess.b2i[currentDragLogic.y * 9 + currentDragLogic.x];
        
        if (!state.customArrows) state.customArrows = [];
        
        // Nếu kéo trùng mũi tên đã có -> Xóa nó đi (Toggle)
        const existingIdx = state.customArrows.findIndex(a => a.from === fromIccs && a.to === toIccs);
        if (existingIdx !== -1) {
            state.customArrows.splice(existingIdx, 1);
        } else {
            state.customArrows.push({ from: fromIccs, to: toIccs });
        }
    }
    
    dragStartLogic = null;
    currentDragLogic = null;
}

// --- LOGIC CLICK CHỌN QUÂN BÌNH THƯỜNG ---
function handleCanvasClick(event) {
    if (!boardRect || boardRect.width === 0) return;
    const { logicX, logicY } = getLogicPosFromEvent(event);

    if (logicX < 0 || logicX > 8 || logicY < 0 || logicY > 9) return;
    const boardNum = logicY * 9 + logicX;
    const iccsPos = vschess.b2i[boardNum];

    if (state.isEditMode) handleEditSquareClick(iccsPos);
    else handleSquareClick(logicX, logicY, iccsPos);
}

export function getCanvasCoords(logicX, logicY) {
    const drawX = state.isBoardFlipped ? 8 - logicX : logicX;
    const drawY = state.isBoardFlipped ? 9 - logicY : logicY;
    const paddingX = boardRect.width * 0.07;
    const paddingY = boardRect.height * 0.065;
    const gridWidth = boardRect.width - (paddingX * 2);
    const gridHeight = boardRect.height - (paddingY * 2);
    const cellX = gridWidth / 8;
    const cellY = gridHeight / 9;

    return { cx: paddingX + (drawX * cellX), cy: paddingY + (drawY * cellY) };
}

// VÒNG LẶP RENDER CHÍNH
function renderLoop() {
    if (!ctx || !boardRect.width) { requestAnimationFrame(renderLoop); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawLastMoveHighlights();
    drawStaticPieces();          // Vẽ các quân cờ bình thường trước
    drawAnimatingPiece();        // Vẽ quân đang bay
    drawSelectedPiece();         // <--- VẼ QUÂN ĐANG CHỌN PHÁT SÁNG NỔI LÊN TRÊN
    drawLegalMoveDots();         // Vẽ chấm xanh nước đi
    drawBestMoveArrowCanvas();   // Vẽ mũi tên AI
    drawCustomArrowsCanvas();

    requestAnimationFrame(renderLoop);
}

// --- HÀM VẼ MŨI TÊN DO NGƯỜI DÙNG TỰ KÉO THẢ ---
function drawCustomArrowsCanvas() {
    const drawSingleArrow = (fromIccs, toIccs, color, rank) => {
        const fXY = vschess.i2b[fromIccs];
        const tXY = vschess.i2b[toIccs];
        const p1 = getCanvasCoords(fXY % 9, Math.floor(fXY / 9));
        const p2 = getCanvasCoords(tXY % 9, Math.floor(tXY / 9));

        const dx = p2.cx - p1.cx;
        const dy = p2.cy - p1.cy;
        const angle = Math.atan2(dy, dx);
        const distance = Math.sqrt(dx * dx + dy * dy);

        const headLength = pieceSize * 0.3;      
        const headWidth = pieceSize * 0.45;       
        const tailStartWidth = pieceSize * 0.03; 
        const tailEndWidth = pieceSize * 0.2;   

        ctx.save();
        ctx.translate(p1.cx, p1.cy);
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.moveTo(0, tailStartWidth / 2);                    
        ctx.lineTo(distance - headLength, tailEndWidth / 2);  
        ctx.lineTo(distance - headLength, headWidth / 2);     
        ctx.lineTo(distance, 0);                              
        ctx.lineTo(distance - headLength, -headWidth / 2);    
        ctx.lineTo(distance - headLength, -tailEndWidth / 2); 
        ctx.lineTo(0, -tailStartWidth / 2);                   
        ctx.closePath();

        ctx.fillStyle = color;
        ctx.fill();       
        ctx.restore(); 

        if (rank !== null && rank !== "") {
            const textOffset = headLength * 0.65;
            const textX = p2.cx - Math.cos(angle) * textOffset;
            const textY = p2.cy - Math.sin(angle) * textOffset;

            ctx.fillStyle = "white"; 
            ctx.font = `bold ${pieceSize * 0.2}px Arial`;
            ctx.textAlign = "center"; 
            ctx.textBaseline = "middle";
            ctx.fillText(rank, textX, textY + 1);
        }
    };

    // Vẽ các mũi tên tĩnh đã lưu trong mảng (Màu xanh dương Hex #1a73e8)
    if (state.customArrows && state.customArrows.length > 0) {
        state.customArrows.forEach((arrow, index) => {
            drawSingleArrow(arrow.from, arrow.to, "#1a73e8bd", index + 1); 
        });
    }

    // Vẽ mũi tên mờ ảo ĐANG TRONG QUÁ TRÌNH KÉO
    if (isPointerDown && dragStartLogic && currentDragLogic) {
        const fromIccs = vschess.b2i[dragStartLogic.y * 9 + dragStartLogic.x];
        const toIccs = vschess.b2i[currentDragLogic.y * 9 + currentDragLogic.x];
        drawSingleArrow(fromIccs, toIccs, "#1a73e8bd", (state.customArrows ? state.customArrows.length + 1 : 1));
    }
}

// Các hàm Render Phụ trợ
function drawLastMoveHighlights() {
    if (!state.lastMove || state.isEditMode) return;
    const fromXY = vschess.i2b[state.lastMove.substring(0, 2)];
    const toXY = vschess.i2b[state.lastMove.substring(2, 4)];
    const p1 = getCanvasCoords(fromXY % 9, Math.floor(fromXY / 9));
    const p2 = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

    const imgFrom = imageCache['from'];
    const imgTo = imageCache['to'];

    // Vẽ ảnh From (Xuất phát)
    if (imgFrom) {
        const size = Math.round(pieceSize * FROM_SCALE);
        ctx.drawImage(imgFrom, Math.round(p1.cx) - size/2, Math.round(p1.cy) - size/2, size, size);
    }
    
    // Vẽ ảnh To (Đích đến)
    if (imgTo) {
        const size = Math.round(pieceSize * TO_SCALE);
        ctx.drawImage(imgTo, Math.round(p2.cx) - size/2, Math.round(p2.cy) - size/2, size, size);
    }
}

function drawSelectedPiece() {
    let selectedIccs = null;
    let logicX, logicY;

    if (state.isEditMode && state.selectedBoardPiece) {
        selectedIccs = state.selectedBoardPiece;
        const toXY = vschess.i2b[selectedIccs];
        logicX = toXY % 9;
        logicY = Math.floor(toXY / 9);
    } else if (!state.isEditMode && state.selectedSquare) {
        selectedIccs = state.selectedSquare.iccs;
        logicX = state.selectedSquare.x;
        logicY = state.selectedSquare.y;
    }

    if (!selectedIccs) return;

    const sIndex = vschess.i2s[selectedIccs];
    const pieceCode = state.currentSituation[sIndex];
    if (pieceCode <= 1) return;

    const imgPiece = getPieceImage(pieceCode);
    const imgSelection = imageCache['selection'];
    if (!imgPiece) return;

    const p = getCanvasCoords(logicX, logicY);
    const cx = Math.round(p.cx);
    const cy = Math.round(p.cy);
    const pSize = Math.round(pieceSize);

    // 1. VẼ ẢNH LỰA CHỌN (selection.webp) NẰM BÊN DƯỚI QUÂN CỜ
    if (imgSelection) {
        const sSize = Math.round(pSize * SELECTION_SCALE);
        ctx.drawImage(imgSelection, cx - sSize/2, cy - sSize/2, sSize, sSize);
    }

    // 2. VẼ QUÂN CỜ ĐÈ LÊN TRÊN
    ctx.drawImage(imgPiece, cx - pSize/2, cy - pSize/2, pSize, pSize);
}

function drawLegalMoveDots() {
    const isBlindMode = state.appMode === 'blind' || (state.appMode === 'memorize' && state.memorizeSettings.isBlind);
    if (isBlindMode && !state.isPeeking) return;
    if (!state.legalMoves || state.legalMoves.length === 0) return;
    
    const imgDot = imageCache['dot'];
    if (!imgDot) return;

    const dSize = Math.round(pieceSize * DOT_SCALE);
    const halfDSize = Math.round(dSize / 2);

    state.legalMoves.forEach(move => {
        const toIccs = move.substring(2, 4);
        const toXY = vschess.i2b[toIccs];
        const p = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

        // Vẽ ảnh dot.webp
        // Lưu ý: Vì trong hàm renderLoop(), drawLegalMoveDots() được gọi SAU hàm drawStaticPieces(),
        // nên chấm dot.webp này sẽ tự động NẰM ĐÈ LÊN TRÊN quân cờ nếu đó là nước ăn quân!
        ctx.drawImage(imgDot, Math.round(p.cx) - halfDSize, Math.round(p.cy) - halfDSize, dSize, dSize);
    });
}

// Trả về ảnh của quân cờ tùy theo chế độ (Thường hoặc Mù)
function getPieceImage(pieceCode) {
    const isBlindMode = state.appMode === 'blind' || (state.appMode === 'memorize' && state.memorizeSettings.isBlind);
    if (isBlindMode && !state.isPeeking) {
        const char = vschess.n2f[pieceCode];
        // Ký tự viết hoa (R, N, B, A, K, C, P) là quân Đỏ
        const isRed = char === char.toUpperCase() && char !== '*'; 
        return isRed ? imageCache['blind_w'] : imageCache['blind_b'];
    }
    return imageCache[vschess.n2f[pieceCode]];
}

function drawStaticPieces() {
    if (!state.currentSituation) return;

    let selectedIccs = state.isEditMode ? state.selectedBoardPiece : (state.selectedSquare ? state.selectedSquare.iccs : null);
    
    // Tính toán trước kích thước và độ lệch
    const pSize = Math.round(pieceSize);
    const halfSize = Math.round(pSize / 2);
    
    // Lấy ảnh shadow và tính kích thước bóng
    const shadowImg = imageCache['shadow'];
    const sSize = Math.round(pSize * SHADOW_SCALE);
    const halfSSize = Math.round(sSize / 2);
    const offsetX = Math.round(pSize * SHADOW_OFFSET_X_PCT);
    const offsetY = Math.round(pSize * SHADOW_OFFSET_Y_PCT);

    for (let index = 51; index < 204; index++) {
        const pieceCode = state.currentSituation[index];
        if (pieceCode > 1) {
            const logicalIccs = vschess.s2i[index];
            if (animState && animState.to === logicalIccs && state.isAnimating) continue;
            if (logicalIccs === selectedIccs) continue;

            const boardNum = vschess.i2b[logicalIccs];
            const img = getPieceImage(pieceCode);
            if (img) {
                const coords = getCanvasCoords(boardNum % 9, Math.floor(boardNum / 9));
                const cx = Math.round(coords.cx);
                const cy = Math.round(coords.cy);

                // VẼ ẢNH BÓNG ĐỔ (Nếu có)
                if (shadowImg) {
                    ctx.drawImage(shadowImg, cx - halfSSize + offsetX, cy - halfSSize + offsetY, sSize, sSize);
                }

                // VẼ QUÂN CỜ
                ctx.drawImage(img, cx - halfSize, cy - halfSize, pSize, pSize);
            }
        }
    }
}

function drawAnimatingPiece() {
    if (!animState || !state.isAnimating) { 
        animState = null; 
        return; 
    }
    
    const startX = animState.startX;
    const startY = animState.startY;
    const endX = animState.endX;
    const endY = animState.endY;
    const pieceCode = animState.piece;

    const elapsed = performance.now() - animState.startTime;
    let progress = elapsed / animState.duration;
    
    if (progress >= 1) { 
        progress = 1; 
        animState = null; 
        state.isAnimating = false; 
    }
    
    const f = 1 - progress;
    const easeOut = 1 - (f * f * f);

    const currentX = Math.round(startX + (endX - startX) * easeOut);
    const currentY = Math.round(startY + (endY - startY) * easeOut);

    const img = getPieceImage(pieceCode);
    if (img) {
        const pSize = Math.round(pieceSize);
        const halfSize = Math.round(pSize / 2);

        // VẼ ẢNH BÓNG ĐỔ KHI BAY (Độ lệch lớn hơn)
        const shadowImg = imageCache['shadow'];
        if (shadowImg) {
            const sSize = Math.round(pSize * SHADOW_SCALE);
            const halfSSize = Math.round(sSize / 2);
            const flyOffsetX = Math.round(pSize * SHADOW_OFFSET_X_PCT);
            const flyOffsetY = Math.round(pSize * SHADOW_OFFSET_Y_PCT);
            
            ctx.drawImage(shadowImg, currentX - halfSSize + flyOffsetX, currentY - halfSSize + flyOffsetY, sSize, sSize);
        }
        
        // VẼ QUÂN CỜ ĐANG BAY
        ctx.drawImage(img, currentX - halfSize, currentY - halfSize, pSize, pSize);
    }
}

function drawBestMoveArrowCanvas() {
    if (state.pvLines.length === 0 || state.isAnimating || state.isEditMode || state.appMode === 'vsbot' 
        || state.appMode === 'blind' || state.appMode === 'memorize' || state.appMode === 'puzzle') return;
    // Kiểm tra xem Động cơ AI có đang được bật hay không (Phân tích, Máy cầm Đỏ, Máy cầm Đen)
    const isAILive = state.isAnalyzing || state.aiPlaysRed || state.aiPlaysBlack;
    // NẾU Cài đặt Tắt Mũi tên NHƯNG AI đã bị tắt -> Vẫn vẽ mũi tên đóng băng cuối cùng!
    if (!state.appSettings.arrows && isAILive) return;

    state.pvLines.forEach(line => {
        if (!line) return;

        // Hàm helper để vẽ 1 mũi tên đa giác
        const drawSingleArrow = (move, color, rank) => {
            if (!move) return;

            const fXY = vschess.i2b[move.substring(0, 2)];
            const tXY = vschess.i2b[move.substring(2, 4)];
            const p1 = getCanvasCoords(fXY % 9, Math.floor(fXY / 9));
            const p2 = getCanvasCoords(tXY % 9, Math.floor(tXY / 9));

            // Tính toán góc xoay và khoảng cách giữa 2 điểm
            const dx = p2.cx - p1.cx;
            const dy = p2.cy - p1.cy;
            const angle = Math.atan2(dy, dx);
            const distance = Math.sqrt(dx * dx + dy * dy);

            // KÍCH THƯỚC CẤU TẠO MŨI TÊN (có thể tinh chỉnh nếu muốn)
            const headLength = pieceSize * 0.3;      // Chiều dài chóp mũi tên
            const headWidth = pieceSize * 0.45;       // Chiều rộng chóp mũi tên
            const tailStartWidth = pieceSize * 0.03; // Độ rộng phần đuôi (nơi xuất phát) - Rất mỏng
            const tailEndWidth = pieceSize * 0.2;   // Độ rộng phần cổ (nơi nối với chóp) - To hơn

            ctx.save();
            // Dời tâm Canvas về điểm xuất phát và xoay theo hướng mũi tên
            ctx.translate(p1.cx, p1.cy);
            ctx.rotate(angle);

            // VẼ PATH HÌNH DÁNG MŨI TÊN
            ctx.beginPath();
            ctx.moveTo(0, tailStartWidth / 2);                    // 1. Trên cùng của đuôi
            ctx.lineTo(distance - headLength, tailEndWidth / 2);  // 2. Trên cùng của cổ
            ctx.lineTo(distance - headLength, headWidth / 2);     // 3. Cạnh trên của chóp
            ctx.lineTo(distance, 0);                              // 4. Đỉnh mũi tên (Điểm đích)
            ctx.lineTo(distance - headLength, -headWidth / 2);    // 5. Cạnh dưới của chóp
            ctx.lineTo(distance - headLength, -tailEndWidth / 2); // 6. Dưới cùng của cổ
            ctx.lineTo(0, -tailStartWidth / 2);                   // 7. Dưới cùng của đuôi
            ctx.closePath();

            // Tô màu trong suốt (theo đúng mã màu Hex 8 kí tự bạn truyền vào)
            ctx.fillStyle = color;
            ctx.fill();       

            ctx.restore(); // Trả Canvas về trạng thái cũ để vẽ Text không bị lộn ngược

            // VẼ CHỮ SỐ (LUÔN NẰM NGANG, KHÔNG BỊ XOAY)
            // Lùi lại một khoảng từ điểm đích để chữ rơi đúng vào giữa chóp mũi tên
            const textOffset = headLength * 0.65;
            const textX = p2.cx - Math.cos(angle) * textOffset;
            const textY = p2.cy - Math.sin(angle) * textOffset;

            ctx.fillStyle = "white"; 
            ctx.font = `bold ${pieceSize * 0.2}px Arial`;
            ctx.textAlign = "center"; 
            ctx.textBaseline = "middle";
            ctx.fillText(rank, textX, textY + 1); 
        };

        // Vẽ mũi tên nước đi chính (Xanh lá mờ theo Hex 8-digit)
        if (line.bestMove) {
            drawSingleArrow(line.bestMove, "#4caf4fbd", line.rank);
        }
        
        // Vẽ mũi tên nước đi dự đoán của đối thủ (Hồng mờ theo Hex 8-digit)
        if (line.ponderMove) {
            drawSingleArrow(line.ponderMove, "#ff4080b9", line.rank);
        }
    });
}

// ==========================================
// CÁC HÀM "BÙ NHÌN" ĐỂ TRÁNH LỖI IMPORT Ở CÁC FILE KHÁC
// ==========================================
export function renderBoardFull(situation) { state.currentSituation = situation; }
export function clearDots() {}
export function clearArrow() {}
export function drawLastMoveDots() {}
export function drawBestMoveArrow() {}

// ==========================================
// RENDER LỊCH SỬ NƯỚC ĐI
// ==========================================
export function renderMoveHistory() {
    const container = document.getElementById('move-list-container');
    container.innerHTML = ''; 
    const path = getMainLine(); 

    // BƯỚC 1: Kiểm tra xem Bàn cờ gốc (lúc chưa đi nước nào) là Đỏ hay Đen đi trước
    let isRootBlack = false;
    if (path.length > 0 && path[0].fen) {
        isRootBlack = path[0].fen.split(" ")[1] === "b";
    }

    for (let i = 0; i < path.length; i++) {
        const node = path[i]; 
        ensureNodeData(node);
        const btn = document.createElement('button');
        
        if (i === 0) {
            btn.className = 'move-box header-box'; 
            btn.innerText = "Nước Đi";
        } else {
            btn.className = 'move-box';
            if (i > state.currentStepNum) btn.classList.add('move-future');
            
            const wasRedMove = node.fen.split(" ")[1] === "b";
            
            // Lấy số Round thực tế từ FEN
            let rawRoundNum = parseInt(node.roundNum, 10);
            if (isNaN(rawRoundNum) || rawRoundNum === 0) rawRoundNum = 1;

            // BƯỚC 2: CÔNG THỨC BÙ TRỪ 
            // Nếu Đen đi trước -> Trừ đi 1 để Đỏ hiển thị đúng số 1
            let displayRoundNum = rawRoundNum - (isRootBlack ? 1 : 0);
            if (displayRoundNum < 1) displayRoundNum = 1; // Đảm bảo không bao giờ < 1
            
            let htmlStr = '';
            // Gắn displayRoundNum vào html của quân Đỏ
            if (wasRedMove) htmlStr = `<span class="move-num">${displayRoundNum}.</span> <span class="move-text text-red">${node.notation}</span>`;
            else htmlStr = `<span class="move-num"></span> <span class="move-text text-black">${node.notation}</span>`;

            if (node.parent && node.parent.children.length > 1) {
                const badgeClass = wasRedMove ? 'var-red' : 'var-black';
                htmlStr += `<span class="var-badge ${badgeClass}">(*)</span>`;
            }
            btn.innerHTML = htmlStr;
        }
        
        if (i === state.currentStepNum) {
            btn.classList.add('move-active'); 
            btn.classList.remove('move-future'); 
            btn.id = 'active-move-btn'; 
        }

        btn.onclick = () => {
            if (state.isAutoPlaying) toggleAutoPlay(); 
            if (i === 0) { forceStopAIPlayers(); jumpToNode(state.rootNode); return; }
            
            if (node !== state.currentNode) {
                // Nhảy đến nước cờ khác (Bình thường)
                jumpToNode(node); 
            } 
            else if (node.parent && node.parent.children.length > 1) {
                // Nếu click vào chính nước cờ đang đứng và nó có biến hóa:
                // -> CHẶN LẠI NẾU ĐANG BẬT BIỂU ĐỒ
                if (state.isChartRunning) {
                    return;
                }
                
                // Mở bảng chọn biến nếu không bật biểu đồ
                openModal('variation-modal');
            }
        };
        container.appendChild(btn);
    }
    setTimeout(() => {
        const activeBtn = document.getElementById('active-move-btn');
        if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50); 
    const commentBox = document.getElementById('comment-box');
    if (commentBox) commentBox.value = state.currentNode.comment || "";

    if (state.isChartRunning && !state.isChartDrawing) {
        import('./chart.js').then(chart => chart.refreshChartUI());
    }
}