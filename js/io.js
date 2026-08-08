// js/io.js
import { showToast, showLoading, hideLoading, closeModal, openModal, updateTurnToggleUI } from './ui.js';
import { state, storage } from './state.js';
import { defaultGameInfo } from './config.js';
import { loadGameFromList, initGame} from './game.js';
import { saveWorkspace } from './db.js';
import { turnOnEditMode } from './editor.js';
import { renderBoardFull, renderMoveHistory, clearArrow } from './board.js';

export function formatGameInfoString(info, rootCommentText) {
    let str = "";
    if (info.title) str += `Tiêu đề: ${info.title}\n`;
    if (info.result) {
        const resMap = {"1-0": "Đỏ thắng", "0-1": "Đen thắng", "1/2-1/2": "Hòa", "*": "Chưa rõ/Đang đánh"};
        str += `Kết quả: ${resMap[info.result] || info.result}\n`;
    }
    if (info.author) str += `Tác giả: ${info.author}\n`;
    if (str !== "") str += `-------------------\n`;
    if (rootCommentText) str += rootCommentText;
    return str;
}

export function mergeGameInfo(infoData) {
    if (!infoData) return Object.assign({}, defaultGameInfo);
    let mergedInfo = {};
    for (let key in defaultGameInfo) {
        mergedInfo[key] = infoData[key] ? infoData[key] : defaultGameInfo[key];
    }
    return mergedInfo;
}

export function getFormattedDate() {
    const d = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${pad(d.getDate())}${pad(d.getMonth()+1)}${d.getFullYear()}`;
}

export function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showToast("✅ Đã sao chép vào bộ nhớ tạm!")).catch(() => showToast("❌ Lỗi Copy!"));
    } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus(); textArea.select();
        try { document.execCommand('copy'); showToast("✅ Đã sao chép vào bộ nhớ tạm!"); } catch (err) { showToast("❌ Lỗi Copy!"); }
        document.body.removeChild(textArea);
    }
}

export function downloadFile(filename, content, isBinary = false) {
    let blob;
    if (isBinary) {
        blob = new Blob([new Uint8Array(content)], { type: "application/octet-stream" });
    } else {
        blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast(`✅ Đã tải tệp ${filename} thành công!`);
}

export function getMoveListAndComments() {
    let moves = [];
    let comments = [state.rootNode.comment || ""];
    let temp = state.rootNode;
    while(temp.children.length > 0) {
        temp = temp.children[temp.mainLineIndex];
        moves.push(temp.moveCommand);
        comments.push(temp.comment || "");
    }
    return { moves, comments };
}

export function getVschessNodeTree(node) {
    if (!node) return null;
    let vNode = {
        id: node.id || "",
        fen: node.fen,
        comment: node.comment || "",
        move: node.moveCommand || "", 
        defaultIndex: node.mainLineIndex || 0,
        next: []
    };
    for (let i = 0; i < node.children.length; i++) {
        vNode.next.push(getVschessNodeTree(node.children[i]));
    }
    return vNode;
}

export function serializeMoveTree() {
    if (!state.rootNode) return "";
    const vNode = getVschessNodeTree(state.rootNode);
    return vschess.nodeToData_DhtmlXQ(vNode, state.currentGameInfo, false);
}

export function serializeMoveTreePtr() {
    if (!state.currentNode) return null;
    return JSON.stringify({
        fen: state.currentNode.fen,
        move: state.currentNode.moveCommand,
        id: state.currentNode.id
    });
}

let saveTimeout = null;
let isSaving = false;

export async function saveGameState() {
    if (isSaving || state.isEditMode || state.gameList.length === 0 || state.appMode === 'memorize' || state.appMode === 'puzzle') return;
    isSaving = true;
    
    try {
        // LƯU TRỰC TIẾP Object trên RAM vào mảng (IndexedDB sẽ dùng Structured Clone tự lưu vòng)
        // Không gọi stripTree nữa, thời gian nén = 0 ms!
        state.gameList[state.currentGameIndex].node = state.rootNode;
        state.gameList[state.currentGameIndex].info = state.currentGameInfo;
        
        const workspaceData = {
            mode: state.appMode,
            gameList: state.gameList, 
            currentIndex: state.currentGameIndex,
            ptrId: state.currentNode.id
        };

        let dbKey = 'analyze_workspace';
        if (state.appMode === 'vsbot') dbKey = 'vsbot_workspace';
        else if (state.appMode === 'blind') dbKey = 'blind_workspace';
        
        await saveWorkspace(dbKey, workspaceData);

        storage.saveSystem(state.appSettings);
    } catch (e) {
        console.error("Lỗi khi Auto-Save IndexedDB:", e);
    } finally {
        isSaving = false;
    }
}

export function handleFileUpload(file) {
    if (state.isEditMode) { showToast("❌ Vui lòng tắt chế độ Xếp quân trước khi tải ván đấu!"); return; }
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    const validBinary = ['xqf', 'cbr', 'ccm', 'cbl','CBL'];
    const validText = ['pgn', 'pfc', 'che'];
    
    showLoading(`Đang đọc tệp ${file.name}...`);

    if (validBinary.includes(extension)) {
        reader.onload = (e) => {
            try {
                const buffer = new Uint8Array(e.target.result);
                state.gameList = []; // XÓA LIST CŨ

                if (extension === 'cbl' || extension === 'CBL') {
                    // XỬ LÝ FILE ĐA VÁN ĐẤU
                    const cblData = vschess.binaryToBook_CBL(buffer);
                    if (cblData && cblData.books && cblData.books.length > 0) {
                        state.gameList = cblData.books; // Gán toàn bộ mảng 100 ván vào State
                    }
                } else {
                    // XỬ LÝ FILE 1 VÁN
                    let nodeData, infoData;
                    if (extension === 'xqf') { nodeData = vschess.binaryToNode_XQF(buffer); infoData = vschess.binaryToInfo_XQF(buffer); }
                    else if (extension === 'cbr') { nodeData = vschess.binaryToNode_CBR(buffer); infoData = vschess.binaryToInfo_CBR(buffer); }
                    else if (extension === 'ccm') { nodeData = vschess.binaryToNode_CCM(buffer); }
                    
                    if (nodeData && nodeData.fen) {
                        state.gameList = [{ info: infoData, node: nodeData }]; // Bọc thành mảng 1 ván
                    }
                }

                if (state.gameList.length > 0) {
                    loadGameFromList(0); // Load ván đầu tiên lên RAM
                    saveGameState(); // Auto-save xuống IndexedDB
                    closeModal('import-modal');
                    showToast(`✅ Tải thành công ${state.gameList.length} ván đấu!`);
                } else { 
                    showToast("❌ Lỗi đọc File (File hỏng hoặc trống)!"); 
                }
            } catch (error) { showToast("❌ Có lỗi xảy ra khi giải mã File!"); }
            hideLoading();
        };
        reader.readAsArrayBuffer(file);
    } else if (validText.includes(extension)) {
        reader.onload = (e) => {
            try {
                const textData = e.target.result;
                let nodeData, infoData;
                if (extension === 'pgn') { nodeData = vschess.dataToNode_PGN(textData); infoData = vschess.dataToInfo_PGN(textData); }
                else if (extension === 'pfc') { nodeData = vschess.dataToNode_PFC(textData); infoData = vschess.dataToInfo_PFC(textData); }
                else if (extension === 'che') { nodeData = vschess.dataToNode_QQNew(textData); }
                if (nodeData && nodeData.fen) {
                    // SỬA Ở ĐÂY: Reset gameList và nạp ván mới dạng Object thô
                    state.gameList = [{ info: infoData, node: nodeData }];
                    loadGameFromList(0); // Nạp ván đầu tiên lên RAM
                    
                    closeModal('import-modal');
                    saveGameState(); // Lưu ngầm xuống IndexedDB
                    showToast("✅ Tải file Văn Bản thành công!");
                } else { showToast("❌ Lỗi đọc File Text (File hỏng)!"); }
            } catch (error) { showToast("❌ Có lỗi xảy ra khi phân tích File!"); }
            hideLoading();
        };
        reader.readAsText(file);
    } else {
        hideLoading();
        showToast(`❌ Định dạng .${extension} không được hỗ trợ!`);
    }
}

// Hàm nén ảnh trước khi gửi lên Server
function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) {
    return new Promise((resolve) => {
        // Chỉ xử lý nếu file là ảnh, nếu không trả về file gốc
        if (!file.type.startsWith('image/')) {
            return resolve(file);
        }

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            // Giải phóng bộ nhớ ngay sau khi load xong ảnh
            URL.revokeObjectURL(objectUrl);

            let { width, height } = img;

            // Tính toán kích thước mới giữ nguyên tỷ lệ khung hình
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            // Tạo canvas ảo
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Vẽ ảnh lên canvas
            ctx.drawImage(img, 0, 0, width, height);

            // Xuất file ảnh JPEG với chất lượng 0.8
            canvas.toBlob((blob) => {
                if (!blob) {
                    return resolve(file); // Trả về file gốc nếu tạo blob thất bại
                }
                
                // Đổi đuôi file thành .jpg
                const newFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                const compressedFile = new File([blob], newFileName, {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                });
                
                resolve(compressedFile); // Trả về file đã nén
            }, 'image/jpeg', quality);
        };

        img.onerror = () => {
            // Xử lý giải phóng bộ nhớ và trả về file gốc nếu lỗi
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };

        img.src = objectUrl;
    });
}

export async function handleImageRecognition(file) {
    if (state.isEditMode) { showToast("❌ Vui lòng tắt chế độ Xếp quân trước khi quét ảnh!"); return; }
    if (!navigator.onLine) { showToast("❌ Bạn đang Offline! Cần kết nối Internet để quét ảnh."); return; }
    if (!file) return;

    showLoading("Đang nén và quét ảnh bằng AI...");
    
    // Gọi hàm nén ảnh trước khi nạp vào FormData
    const compressedFile = await compressImage(file, 1920, 1920, 0.8);

    const formData = new FormData(); 
    // Sử dụng compressedFile thay vì file gốc
    formData.append('image', compressedFile);

    fetch('/api/pikafish-recognize', { method: 'POST', body: formData })
    .then(res => res.json())
    .then(result => {
        if (result && result.data && result.data.fen) {
            let fen = result.data.fen;
            if (!fen.includes(' w ') && !fen.includes(' b ')) {
                fen += " w - - 0 1"; 
            }
            
            closeModal('import-modal');

            // LƯU LẠI THÔNG TIN VÁN CỜ CŨ TRƯỚC KHI GHI ĐÈ ẢNH QUÉT
            const trueOriginalFen = state.currentNode.fen;
            const trueOriginalNode = state.currentNode;
            const trueOriginalStepNum = state.currentStepNum;

            // Ghi đè bàn cờ bằng cách cập nhật gameList hiện tại
            let rawNode = { fen: fen, comment: "", next: [], defaultIndex: 0 };
            state.gameList = [{ info: Object.assign({}, defaultGameInfo), node: rawNode }]; 
            loadGameFromList(0); 
            clearArrow();
            
            // Ép hệ thống chuyển sang chế độ Xếp quân
            const btn = document.getElementById('btn-edit');
            if(!state.isEditMode) {
                state.isEditMode = true;
                btn.classList.add('tool-active');
                document.body.classList.add('edit-mode');
                document.getElementById('btn-clear-board').style.display = 'flex';
                
                const btnUndo = document.getElementById('btn-undo');
                if(btnUndo) btnUndo.style.setProperty('display', 'none', 'important');
                const btnHint = document.getElementById('btn-hint');
                if(btnHint) btnHint.style.setProperty('display', 'none', 'important');
                
                if(window.innerWidth > window.innerHeight) {
                    document.getElementById('piece-palette-pc').style.display = 'flex';
                } else {
                    document.getElementById('piece-palette-mobile').style.display = 'flex';
                }
            }

            // Gán dữ liệu so sánh cho trình Editor
            state.preEditFenBase = trueOriginalFen.split(" ")[0];
            state.preEditTurn = trueOriginalFen.split(" ")[1] || 'w';
            state.preEditNode = trueOriginalNode;
            state.preEditStepNum = trueOriginalStepNum;
            
            state.editTurn = fen.split(" ")[1] || 'w';
            updateTurnToggleUI();
            
            renderBoardFull(state.currentSituation);
            renderMoveHistory();
            saveGameState();
            
            showToast("📸 Đã nhận diện! Vui lòng chỉnh sửa (nếu có lỗi) rồi nhấn nút Xếp Quân để bắt đầu.");
        } else {
            showToast("❌ Lỗi nhận diện từ AI: " + (result.msg || "Không tìm thấy bàn cờ hợp lệ"));
        }
    })
    .catch(err => { showToast("❌ Lỗi: Máy chủ nhận diện không phản hồi."); })
    .finally(() => { hideLoading(); });
}