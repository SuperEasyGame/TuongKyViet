// js/ui.js
import { state } from './state.js';
import { forceStopAIPlayers, jumpToNode, ensureNodeData,loadGameFromList } from './game.js';
import { getWorkspace, saveWorkspace, deleteWorkspace } from './db.js';

let toastTimeout;

export function showToast(message) {
    const toast = document.getElementById('toast-container');
    if (!toast) return;
    toast.innerHTML = message;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

export function showLoading(msg) {
    const overlay = document.getElementById('loading-overlay');
    overlay.innerHTML = `<div class="spinner"></div><h2 style="color:white; margin-top:15px;">${msg}</h2>`;
    overlay.style.display = 'flex'; 
    overlay.style.opacity = '1';
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.opacity = '0'; 
    setTimeout(() => overlay.style.display = 'none', 300);
}

export function syncNavbarWidth() {
    const boardArea = document.getElementById('chess-board-area');
    const navBar = document.getElementById('nav-bar');
    if(boardArea && navBar) navBar.style.width = `${boardArea.offsetWidth}px`;
}

export function updateTurnToggleUI() {
    document.querySelectorAll('.palette-turn-toggle').forEach(toggle => {
        if (state.editTurn === 'w') {
            toggle.className = 'palette-turn-toggle turn-red';
            toggle.innerHTML = 'Bên Đỏ<br>Đi Trước';
        } else {
            toggle.className = 'palette-turn-toggle turn-black';
            toggle.innerHTML = 'Bên Đen<br>Đi Trước';
        }
    });
}

export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (modalId === 'variation-modal') {
        state.editingParentNode = state.currentNode.parent;
        renderVariationModal();
    }
    if (modalId === 'info-modal') {
        for (let key in state.currentGameInfo) {
            const input = document.getElementById(`info-${key}`);
            if (input) input.value = state.currentGameInfo[key];
        }
    }
    modal.style.display = 'flex';
    setTimeout(() => { modal.classList.add('show'); }, 30);
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('show'); 
    setTimeout(() => { modal.style.display = 'none'; }, 300); 
}

export function renderVariationModal() {
    const listContainer = document.getElementById('variation-list-container'); 
    listContainer.innerHTML = '';
    
    state.editingParentNode.children.forEach((child, index) => {
        ensureNodeData(child);
        const row = document.createElement('div'); 
        row.className = 'var-row';
        const isMain = (index === state.editingParentNode.mainLineIndex);
        if (isMain) row.classList.add('var-row-active');

        const indexSpan = document.createElement('span'); 
        indexSpan.className = 'var-index'; 
        indexSpan.innerText = `${index + 1}.`;
        
        const textSpan = document.createElement('div'); 
        textSpan.className = `var-text-modal ${isMain ? 'var-text-active' : ''}`; 
        textSpan.innerText = child.notation;
        
        row.onclick = () => { 
            forceStopAIPlayers(); 
            state.editingParentNode.mainLineIndex = index; 
            jumpToNode(child); 
            renderVariationModal(); 
        };

        const btnDel = document.createElement('button'); 
        btnDel.className = 'var-btn-del'; 
        btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        btnDel.onclick = (e) => { 
            e.stopPropagation(); 
            deleteVariation(index); 
        };

        row.appendChild(indexSpan); 
        row.appendChild(textSpan); 
        row.appendChild(btnDel); 
        listContainer.appendChild(row);
    });
}

export function deleteVariation(index) {
    if (state.editingParentNode.children.length === 1) return; 
    
    state.editingParentNode.children.splice(index, 1);
    if (state.editingParentNode.mainLineIndex === index) {
        state.editingParentNode.mainLineIndex = 0; 
        jumpToNode(state.editingParentNode.children[0]); 
    } else if (state.editingParentNode.mainLineIndex > index) {
        state.editingParentNode.mainLineIndex--;
    }
    renderVariationModal();
}
// Đóng mở Menu chính
export function toggleMainMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('main-menu-panel');
    if (menu) menu.classList.toggle('show-menu');
}

export function closeMainMenu() {
    const menu = document.getElementById('main-menu-panel');
    if (menu && menu.classList.contains('show-menu')) {
        menu.classList.remove('show-menu');
    }
}

// Các hằng số tính toán cho Virtual List
let ITEM_HEIGHT = 52; // Mặc định PC: 44px height + 8px margin 52
let VISIBLE_ITEMS = 25; // Số lượng nút tái chế tối đa tạo ra
let domPool = []; // Mảng chứa các nút DOM tái chế

export function renderGameList(forceScrollToActive = false) {
    const titleTab = document.getElementById('tab-title');
    if (!titleTab) return;

    if (!state.gameList || state.gameList.length <= 1) {
        const oldViewport = document.getElementById('game-list-viewport');
        if (oldViewport) oldViewport.remove();
        return;
    }

    const isMobile = (window.innerWidth / window.innerHeight) <= 1;
    ITEM_HEIGHT = isMobile ? 42 : 52; 

    let viewport = document.getElementById('game-list-viewport');
    let spacer, container;

    if (!viewport) {
        viewport = document.createElement('div');
        viewport.id = 'game-list-viewport';
        
        spacer = document.createElement('div');
        spacer.id = 'game-list-spacer';
        
        container = document.createElement('div');
        container.id = 'game-list-container';

        viewport.appendChild(spacer);
        viewport.appendChild(container);
        titleTab.appendChild(viewport);

        domPool = [];
        for (let i = 0; i < VISIBLE_ITEMS; i++) {
            const btn = document.createElement('button');
            btn.className = 'game-list-btn';
            btn.innerHTML = `<span class="game-index"></span><span class="game-title"></span>`;
            
            btn.onclick = () => {
                const gameIndex = parseInt(btn.dataset.index);
                if (isNaN(gameIndex) || gameIndex === state.currentGameIndex) return;
                
                // MỞ RỘNG IMPORT ĐỂ LẤY THÊM saveGameState TỪ io.js
                Promise.all([
                    import('./game.js'),
                    import('./io.js'),
                    import('./engine.js')
                ]).then(([gameModule, ioModule, engineModule]) => {
                    gameModule.forceStopAIPlayers();
                    gameModule.loadGameFromList(gameIndex);
                    
                    renderGameList(false); 
                    
                    // LƯU NGAY LẬP TỨC: Cập nhật vị trí ván đấu mới xuống IndexedDB
                    ioModule.saveGameState();
                    
                    if (state.isAnalyzing) {
                        engineModule.triggerEngineEvaluation();
                    }
                });
            };
            
            domPool.push(btn);
            container.appendChild(btn);
        }

        viewport.addEventListener('scroll', () => {
            requestAnimationFrame(updateVirtualList);
        });
        
        // Mới khởi tạo lần đầu thì mặc định được phép cuộn
        forceScrollToActive = true;
    } else {
        spacer = document.getElementById('game-list-spacer');
        container = document.getElementById('game-list-container');
    }

    spacer.style.height = `${state.gameList.length * ITEM_HEIGHT}px`;

    // CHỈ TỰ ĐỘNG CUỘN KHI forceScrollToActive = TRUE (Lúc F5 hoặc lúc tải file)
    if (forceScrollToActive) {
        const targetScrollTop = state.currentGameIndex * ITEM_HEIGHT;
        viewport.scrollTop = targetScrollTop - (viewport.clientHeight / 2) + (ITEM_HEIGHT / 2);
    }

    updateVirtualList();
}

function updateVirtualList() {
    const viewport = document.getElementById('game-list-viewport');
    if (!viewport || domPool.length === 0) return;

    const scrollTop = viewport.scrollTop;
    
    // Tính toán xem đang ở "trang" nào của danh sách
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 2); // Trừ hao 2 nút ở trên cùng cho mượt
    const endIndex = Math.min(state.gameList.length - 1, startIndex + VISIBLE_ITEMS - 1);

    // Dịch chuyển Container chứa 15 nút xuống đúng vị trí cuộn
    const container = document.getElementById('game-list-container');
    container.style.transform = `translateY(${startIndex * ITEM_HEIGHT}px)`;

    // Đổ dữ liệu Data vào các nút DOM có sẵn
    for (let i = 0; i < VISIBLE_ITEMS; i++) {
        const btn = domPool[i];
        const dataIndex = startIndex + i;

        if (dataIndex <= endIndex) {
            const game = state.gameList[dataIndex];
            let title = (game.info && game.info.title) ? game.info.title : "Ván đấu mặc định";
            
            // Chỉ cập nhật dữ liệu DOM, KHÔNG TẠO MỚI thẻ
            btn.style.display = 'flex';
            btn.dataset.index = dataIndex;
            btn.querySelector('.game-index').innerText = `${dataIndex + 1}.`;
            
            const titleEl = btn.querySelector('.game-title');
            titleEl.innerText = title;
            titleEl.title = title;

            // Xử lý viền xanh cho nút đang Active
            if (dataIndex === state.currentGameIndex) {
                btn.classList.add('game-btn-active');
            } else {
                btn.classList.remove('game-btn-active');
            }
        } else {
            // Giấu các nút dư thừa ở đáy (nếu mảng < 15)
            btn.style.display = 'none';
        }
    }
}
export function showAILoading() {
    if (!state.isChartRunning && (state.appMode === 'analyze' || state.appMode === 'blind')) return;
    
    const spinner = document.getElementById('ai-thinking-spinner');
    if (spinner) spinner.style.display = 'block';
}

export function hideAILoading() {
    const spinner = document.getElementById('ai-thinking-spinner');
    if (spinner) spinner.style.display = 'none';
}

// ==========================================
// CÔNG NGHỆ VIRTUAL LIST & QUẢN LÝ THƯ VIỆN CÂY
// ==========================================
let currentLibraryData = [];
let libDomPool = [];
const LIB_ITEM_HEIGHT = 48; 
const LIB_VISIBLE_ITEMS = 25; 

export let pendingLibAction = { id: "", type: "", name: "" }; // Lưu trữ Item đang được thao tác
export function setPendingLibAction(data) {pendingLibAction = data;}

// Hàm chuẩn hóa Data: Ép dữ liệu phẳng cũ sang dạng Cây
export async function normalizeLibraryData() {
    let rawList = await getWorkspace('library_workspace');
    if (!rawList) rawList = [];
    
    let hasChanged = false;
    for (let i = 0; i < rawList.length; i++) {
        // Nếu là data cũ chưa có type -> Gán mặc định là file và nằm ở root
        if (!rawList[i].type) {
            rawList[i].id = rawList[i].id_key; // Đổi id_key thành id cho chuẩn
            rawList[i].name = rawList[i].file_name;
            rawList[i].type = "file";
            rawList[i].parentId = "root";
            delete rawList[i].id_key;
            delete rawList[i].file_name;
            hasChanged = true;
        }
    }
    
    if (hasChanged) await saveWorkspace('library_workspace', rawList);
    return rawList;
}

export async function renderLibraryList() {
    showLoading("Đang tải thư viện...");
    const rawList = await normalizeLibraryData();
    
    let filteredList = rawList.filter(item => item.parentId === state.currentLibraryFolderId);
    
    // Lọc riêng Thư mục và File, lật ngược từng cái rồi ghép lại để Thư mục LUÔN nằm trên
    let folders = filteredList.filter(item => item.type === "folder").reverse();
    let files = filteredList.filter(item => item.type === "file").reverse();
    
    currentLibraryData = [...folders, ...files];

    const viewport = document.getElementById('lib-list-viewport');
    const spacer = document.getElementById('lib-list-spacer');
    const container = document.getElementById('lib-list-container');
    const emptyText = document.getElementById('lib-empty-text');
    
    // Cập nhật Tiêu đề và Nút Back
    const titleSub = document.getElementById('lib-modal-subtitle');
    const btnBack = document.getElementById('btn-lib-back');
    if (state.currentLibraryFolderId === "root") {
        titleSub.style.display = 'none';
        btnBack.style.display = 'none';
    } else {
        const currentFolder = rawList.find(f => f.id === state.currentLibraryFolderId);
        titleSub.innerText = currentFolder ? currentFolder.name : "Thư mục";
        titleSub.style.display = 'block';
        btnBack.style.display = 'block';
    }

    if (currentLibraryData.length === 0) {
        emptyText.style.display = 'block';
        spacer.style.height = '0px';
        container.innerHTML = '';
        libDomPool = []; 
        hideLoading();
        return;
    } else {
        emptyText.style.display = 'none';
    }

    if (libDomPool.length === 0) {
        container.innerHTML = '';
        for (let i = 0; i < LIB_VISIBLE_ITEMS; i++) {
            const item = document.createElement('div');
            item.className = 'lib-item';
            item.innerHTML = `
                <span class="lib-icon" style="margin-right: 8px; font-size: 18px;">📄</span>
                <span class="lib-title"></span>
                <div class="lib-actions" style="display: flex; gap: 5px;">
                    <button class="lib-btn-edit" style="display:none;" title="Đổi tên">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#e39817" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="lib-btn-del" title="Xóa">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                </div>
            `;
            
            item.onclick = (e) => {
                if(e.target.closest('.lib-actions')) return; 
                
                if (item.dataset.type === "folder") {
                    state.libraryHistory.push(state.currentLibraryFolderId);
                    state.currentLibraryFolderId = item.dataset.id;
                    renderLibraryList();
                } else {
                    loadGameFromLibrary(item.dataset.id);
                }
            };

            item.querySelector('.lib-btn-edit').onclick = (e) => {
                e.stopPropagation();
                pendingLibAction = { id: item.dataset.id, type: item.dataset.type, name: item.dataset.name };
                document.getElementById('folder-action-title').innerText = "Đổi Tên Thư Mục";
                document.getElementById('input-folder-name').value = item.dataset.name;
                openModal('folder-action-modal');
            };

            item.querySelector('.lib-btn-del').onclick = (e) => {
                e.stopPropagation(); 
                pendingLibAction = { id: item.dataset.id, type: item.dataset.type, name: item.dataset.name };
                
                const nameEl = document.getElementById('delete-lib-name');
                const descEl = document.getElementById('delete-lib-desc');
                nameEl.innerText = item.dataset.name;
                
                if (item.dataset.type === "folder") {
                    descEl.innerHTML = "Xóa thư mục này sẽ <strong style='color:#d32f2f;'>XÓA TOÀN BỘ</strong><br>các ván đấu và thư mục con bên trong!";
                } else {
                    descEl.innerHTML = "Bạn có muốn xóa ván đấu này không?";
                }
                openModal('delete-lib-modal');
            };

            const cssBtn = `width: 34px; height: 34px; background: transparent; border: 1px solid transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all 0.2s;`;
            item.querySelector('.lib-btn-edit').style.cssText = cssBtn;
            item.querySelector('.lib-btn-del').style.cssText = cssBtn;
            item.querySelector('.lib-btn-del').style.color = "#ff4d4f";

            item.querySelector('.lib-btn-edit').onmouseenter = function() { this.style.background = "#fff8e1"; this.style.borderColor = "#ffcc80"; };
            item.querySelector('.lib-btn-edit').onmouseleave = function() { this.style.background = "transparent"; this.style.borderColor = "transparent"; };
            item.querySelector('.lib-btn-del').onmouseenter = function() { this.style.background = "#ffebee"; this.style.borderColor = "#ffcdd2"; };
            item.querySelector('.lib-btn-del').onmouseleave = function() { this.style.background = "transparent"; this.style.borderColor = "transparent"; };

            libDomPool.push(item);
            container.appendChild(item);
        }
        
        viewport.addEventListener('scroll', () => {
            requestAnimationFrame(updateLibraryVirtualList);
        });
    }

    spacer.style.height = `${currentLibraryData.length * LIB_ITEM_HEIGHT}px`;
    viewport.scrollTop = 0;
    updateLibraryVirtualList();
    
    hideLoading();
}

function updateLibraryVirtualList() {
    const viewport = document.getElementById('lib-list-viewport');
    if (!viewport || libDomPool.length === 0) return;

    const scrollTop = viewport.scrollTop;
    const startIndex = Math.max(0, Math.floor(scrollTop / LIB_ITEM_HEIGHT) - 2);
    const endIndex = Math.min(currentLibraryData.length - 1, startIndex + LIB_VISIBLE_ITEMS - 1);

    const container = document.getElementById('lib-list-container');
    container.style.transform = `translateY(${startIndex * LIB_ITEM_HEIGHT}px)`;

    for (let i = 0; i < LIB_VISIBLE_ITEMS; i++) {
        const dom = libDomPool[i];
        const dataIndex = startIndex + i;

        if (dataIndex <= endIndex) {
            const data = currentLibraryData[dataIndex];
            dom.style.display = 'flex';
            dom.dataset.id = data.id;
            dom.dataset.type = data.type;
            dom.dataset.name = data.name;
            
            const titleEl = dom.querySelector('.lib-title');
            const iconEl = dom.querySelector('.lib-icon');
            const btnEdit = dom.querySelector('.lib-btn-edit');
            
            titleEl.innerText = data.name;
            titleEl.title = data.name; 
            
            if (data.type === "folder") {
                iconEl.innerText = "📁";
                btnEdit.style.display = "flex"; 
            } else {
                iconEl.innerText = "📄";
                btnEdit.style.display = "none"; 
            }
        } else {
            dom.style.display = 'none';
        }
    }
}

async function loadGameFromLibrary(fileId) {
    showLoading("Đang mở ván cờ...");
    try {
        const textData = await getWorkspace(fileId);
        if (textData) {
            const nodeData = vschess.dataToNode(textData);
            const infoData = vschess.dataToInfo(textData);
            if (nodeData && nodeData.fen) {
                
                state.appMode = 'analyze';
                state.appSettings.appMode = 'analyze';
                
                document.body.classList.remove('mode-vsbot', 'mode-blind', 'mode-memorize');
                const navBar = document.getElementById('nav-bar');
                if (navBar) { navBar.style.opacity = '1'; navBar.style.pointerEvents = 'auto'; }
                state.isPeeking = false;

                const titleHeader = document.getElementById('tab-title');
                if (titleHeader) {
                    titleHeader.innerHTML = `
                        <strong style="font-size: 17px; color: #333; display: block; width: 100%;">CHẾ ĐỘ PHÂN TÍCH</strong>
                        <div id="blind-turn-indicator" class="blind-only" style="display: none; margin-top: 15px; font-size: 16px; font-weight: bold; color: #555;">
                            Lượt đi: <span id="blind-turn-text">Bên Đỏ</span>
                        </div>
                    `;
                }
                const titleTabBtn = document.querySelector('.ai-tab-btn[data-tab="title"]');
                if (titleTabBtn) titleTabBtn.click();

                document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
                const activeMenuBtn = document.getElementById('menu-analyze');
                if (activeMenuBtn) activeMenuBtn.classList.add('menu-item-active');

                const btnRed = document.getElementById('btn-ai-red');
                if(btnRed) btnRed.classList.remove('tool-active');
                const btnBlack = document.getElementById('btn-ai-black');
                if(btnBlack) btnBlack.classList.remove('tool-active');
                state.aiPlaysRed = false;
                state.aiPlaysBlack = false;

                state.gameList = [{ info: infoData, node: nodeData }];
                
                const [gameModule, ioModule, stateModule] = await Promise.all([
                    import('./game.js'),
                    import('./io.js'),
                    import('./state.js')
                ]);
                
                stateModule.storage.saveSystem(state.appSettings); 
                gameModule.forceStopAIPlayers(); 
                gameModule.loadGameFromList(0); 
                ioModule.saveGameState(); 
                
                closeModal('library-modal');
            } else {
                showToast("❌ File lỗi hoặc không hợp lệ!");
            }
        } else {
            showToast("❌ Không tìm thấy ván cờ (Đã bị xóa?)");
        }
    } catch(e) { showToast("❌ Lỗi khi đọc dữ liệu!"); }
    hideLoading();
}

export async function confirmDeleteLibraryItem() {
    closeModal('delete-lib-modal');
    showLoading("Đang xử lý...");
    
    try {
        let list = await getWorkspace('library_workspace') || [];
        let idsToDelete = [pendingLibAction.id];
        let fileIdsToRemoveFromDb = [];

        if (pendingLibAction.type === "file") {
            fileIdsToRemoveFromDb.push(pendingLibAction.id);
        } else {
            function getAllChildrenIds(parentId) {
                let children = list.filter(item => item.parentId === parentId);
                for (let child of children) {
                    idsToDelete.push(child.id);
                    if (child.type === "file") fileIdsToRemoveFromDb.push(child.id);
                    else getAllChildrenIds(child.id); 
                }
            }
            getAllChildrenIds(pendingLibAction.id);
        }

        for (let fileId of fileIdsToRemoveFromDb) {
            await deleteWorkspace(fileId);
        }
        
        list = list.filter(item => !idsToDelete.includes(item.id));
        await saveWorkspace('library_workspace', list);
        await renderLibraryList();
        
        if (pendingLibAction.type === "file") showToast("✅ Đã xóa ván cờ!");
        else showToast("✅ Đã xóa thư mục và các ván cờ bên trong!");

    } catch(e) {
        showToast("❌ Lỗi trong quá trình xóa!");
    }
    hideLoading();
}

// ==========================================
// CÔNG NGHỆ VIRTUAL LIST DÀNH CHO LUYỆN NHỚ VÁN
// ==========================================
let memoDomPool = [];

export async function renderMemorizeList() {
    showLoading("Đang tải danh sách...");
    let rawList = await normalizeLibraryData();
    
    // Lọc theo thư mục hiện tại của Memo
    let filteredList = rawList.filter(item => item.parentId === state.currentMemoFolderId);
    
    // Sắp xếp: Thư mục trên, File dưới
    let folders = filteredList.filter(item => item.type === "folder").reverse();
    let files = filteredList.filter(item => item.type === "file").reverse();
    currentLibraryData = [...folders, ...files]; 

    const viewport = document.getElementById('memo-list-viewport');
    const spacer = document.getElementById('memo-list-spacer');
    const container = document.getElementById('memo-list-container');
    const emptyText = document.getElementById('memo-empty-text');

    // Cập nhật Tiêu đề và Nút Back
    const titleSub = document.getElementById('memo-modal-subtitle');
    const btnBack = document.getElementById('btn-memo-back');
    if (state.currentMemoFolderId === "root") {
        if (titleSub) titleSub.style.display = 'none';
        if (btnBack) btnBack.style.display = 'none';
    } else {
        const currentFolder = rawList.find(f => f.id === state.currentMemoFolderId);
        if (titleSub) {
            titleSub.innerText = currentFolder ? currentFolder.name : "Thư mục";
            titleSub.style.display = 'block';
        }
        if (btnBack) btnBack.style.display = 'block';
    }

    if (currentLibraryData.length === 0) {
        emptyText.style.display = 'block';
        spacer.style.height = '0px';
        container.innerHTML = '';
        memoDomPool = [];
        hideLoading();
        return;
    } else {
        emptyText.style.display = 'none';
    }

    if (memoDomPool.length === 0) {
        container.innerHTML = '';
        for (let i = 0; i < LIB_VISIBLE_ITEMS; i++) {
            const item = document.createElement('div');
            item.className = 'lib-item';
            // Không có nút xóa/sửa, chỉ có Icon và Text
            item.innerHTML = `
                <span class="lib-icon" style="margin-right: 8px; font-size: 18px;">📄</span>
                <span class="lib-title" style="flex: 1; text-align: left;"></span>
            `;
            
            item.onclick = async () => {
                if (item.dataset.type === "folder") {
                    // Chuyển thư mục
                    state.memoHistory.push(state.currentMemoFolderId);
                    state.currentMemoFolderId = item.dataset.id;
                    renderMemorizeList();
                } else {
                    // Mở ván cờ (Giữ nguyên logic cũ)
                    showLoading("Đang nạp ván đấu...");
                    try {
                        const textData = await getWorkspace(item.dataset.id);
                        if (textData) {
                            const nodeData = vschess.dataToNode(textData);
                            const infoData = vschess.dataToInfo(textData);
                            if (nodeData && nodeData.fen) {
                                state.pendingMemorizeData = { node: nodeData, info: infoData };
                                closeModal('memorize-modal');
                                openModal('memorize-setup-modal');
                            } else showToast("❌ File hỏng!");
                        }
                    } catch(e) {}
                    hideLoading();
                }
            };

            memoDomPool.push(item);
            container.appendChild(item);
        }
        
        viewport.addEventListener('scroll', () => {
            requestAnimationFrame(updateMemoVirtualList);
        });
    }

    spacer.style.height = `${currentLibraryData.length * LIB_ITEM_HEIGHT}px`;
    viewport.scrollTop = 0;
    updateMemoVirtualList();
    
    hideLoading();
}

function updateMemoVirtualList() {
    const viewport = document.getElementById('memo-list-viewport');
    if (!viewport || memoDomPool.length === 0) return;

    const scrollTop = viewport.scrollTop;
    const startIndex = Math.max(0, Math.floor(scrollTop / LIB_ITEM_HEIGHT) - 2);
    const endIndex = Math.min(currentLibraryData.length - 1, startIndex + LIB_VISIBLE_ITEMS - 1);

    const container = document.getElementById('memo-list-container');
    container.style.transform = `translateY(${startIndex * LIB_ITEM_HEIGHT}px)`;

    for (let i = 0; i < LIB_VISIBLE_ITEMS; i++) {
        const dom = memoDomPool[i];
        const dataIndex = startIndex + i;

        if (dataIndex <= endIndex) {
            const data = currentLibraryData[dataIndex];
            dom.style.display = 'flex';
            dom.dataset.id = data.id;
            dom.dataset.type = data.type; // Phải lưu type để bắt sự kiện onclick
            
            const titleEl = dom.querySelector('.lib-title');
            const iconEl = dom.querySelector('.lib-icon');
            
            titleEl.innerText = data.name;
            titleEl.title = data.name;

            // Xử lý đổi Icon
            if (data.type === "folder") {
                iconEl.innerText = "📁";
            } else {
                iconEl.innerText = "📄";
            }

        } else {
            dom.style.display = 'none';
        }
    }
}

export function syncBookTabUI() {
    const typeSelect = document.getElementById('book-type-select');
    if (typeSelect) {
        // Lấy setting từ state (đã được nạp từ localStorage ở state.js)
        const currentType = state.appSettings.bookType || 'cloud';
        typeSelect.value = currentType;

        const cloudTab = document.querySelector('.ai-tab-btn[data-tab="cloudbook"]');
        if (cloudTab) {
            cloudTab.innerText = currentType === 'local' ? "Local Book" : "Cloud Book";
        }
    }
}

// ==========================================
// HƯỚNG DẪN THANH CÔNG CỤ (TOUR GUIDE)
// ==========================================
// 1. Kho dữ liệu cấu hình các công cụ
const GUIDE_DATA = [
    { id: 'guide-menu', selector: '#btn-menu', title: 'Menu', desc: 'Mở danh sách các chế độ chơi, thư viện và cài đặt', modes: ['analyze', 'vsbot', 'blind', 'puzzle', 'memorize'], icon: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>' },
    { id: 'guide-newgame', selector: '#btn-new-game', title: 'Ván mới', desc: 'Xoá ván hiện tại, về thế cờ ban đầu', modes: ['analyze', 'vsbot', 'blind', 'puzzle', 'memorize'], icon: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M9 15h6"/><path d="M12 18v-6"/>' },
    { id: 'guide-undo', selector: '#btn-undo', title: 'Đi lại', desc: 'Lùi lại một nước cờ nếu bạn đi sai', modes: ['vsbot', 'puzzle', 'memorize'], icon: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>' },
    { id: 'guide-hint', selector: '#btn-hint', title: 'Gợi ý', desc: 'Nhờ Máy đi hộ một nước cờ', modes: ['vsbot', 'puzzle'], icon: '<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7" /><path d="M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3" /><path d="M9.7 17l4.6 0" />' },
    { id: 'guide-ai-red', selector: '#btn-ai-red', title: 'Máy cầm Đỏ', desc: 'Máy đi quân Đỏ', modes: ['analyze', 'blind'], icon: '<rect width="18" height="12" x="3" y="4" rx="2" ry="2"/><line x1="2" x2="22" y1="20" y2="20"/>', stroke: '#ff0000' },
    { id: 'guide-ai-black', selector: '#btn-ai-black', title: 'Máy cầm Đen', desc: 'Máy đi quân Đen', modes: ['analyze', 'blind'], icon: '<rect width="18" height="12" x="3" y="4" rx="2" ry="2"/><line x1="2" x2="22" y1="20" y2="20"/>' },
    { id: 'guide-analyze', selector: '#btn-analyze', title: 'Phân tích', desc: 'Máy liên tục chấm điểm thế cờ và gợi ý nước đi', modes: ['analyze'], icon: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>' },
    { id: 'guide-instant', selector: '#btn-go-instant', title: 'Đi ngay', desc: 'Đi nước tốt nhất hiện tại của máy mà không chờ', modes: ['analyze'], icon: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>' },
    { id: 'guide-chart', selector: '#btn-chart', title: 'Biểu đồ', desc: 'Phân tích và đánh giá toàn bộ ván cờ', modes: ['analyze'], icon: '<path d="M12 16v5"/><path d="M16 14.639V21"/><path d="M20 10.656V21"/><path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"/><path d="M4 18.463V21"/><path d="M8 14.656V21"/>' },
    { id: 'guide-flip', selector: '#btn-flip', title: 'Lật bàn cờ', desc: 'Xoay ngược bàn cờ để đổi góc nhìn Đỏ/Đen.', modes: ['analyze', 'vsbot', 'blind', 'puzzle', 'memorize'], icon: '<path d="m17 3-5 5-5-5h10"/><path d="m17 21-5-5-5 5h10"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/>' },
    { id: 'guide-import', selector: '#btn-import', title: 'Nhập', desc: 'Dán nước đi, mở tệp ván cờ hoặc nhận dạng ảnh bàn cờ', modes: ['analyze', 'vsbot'], icon: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="m9 13 3-3 3 3"/>' },
    { id: 'guide-export', selector: '#btn-export', title: 'Xuất & Lưu', desc: 'Lưu vào thư viện hoặc tải file, copy file', modes: ['analyze', 'vsbot', 'puzzle'], icon: '<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/>' },
    { id: 'guide-peek', selector: '#btn-peek', title: 'Hiện / Úp cờ', desc: 'Ẩn hoặc hiện quân cờ trên bàn cờ', modes: ['blind'], icon: '<path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/>' },
    { id: 'guide-edit', selector: '#btn-edit', title: 'Xếp thế cờ', desc: 'Xếp quân tự do rồi phân tích từ thế cờ đó', modes: ['analyze', 'vsbot', 'blind'], icon: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>' },
    { id: 'guide-nav-prev', selector: '#btn-prev', title: 'Lùi / Tiến 1 bước', desc: 'Lùi hoặc tiến một nước trên nhánh hiện tại', modes: ['analyze', 'blind'], icon: '<svg viewBox="0 0 1024 1024"><path fill="#515151" d="m384 512 347.733-309.333C748.8 187.733 750.933 160 736 142.933c-14.933-17.066-42.667-19.2-59.733-4.266L292.267 480c-10.667 8.533-14.934 19.2-14.934 32s4.267 23.467 14.934 32l384 341.333C684.8 891.733 695.467 896 704 896c12.8 0 23.467-4.267 32-14.933 14.933-17.067 14.933-44.8-4.267-59.734z"></path></svg>', customSvg: true },
    { id: 'guide-autoplay', selector: '#btn-auto-play', title: 'Tự động phát', desc: 'Tự động đi tiếp các nước cờ theo thời gian (Hữu ích khi xem lại ván đấu)', modes: ['analyze', 'blind'], icon: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>' },
    { id: 'guide-nav-end', selector: '#btn-end', title: 'Đầu / Cuối', desc: 'Nhảy tới thế cờ có biến trước hoặc sau, không có thì về đầu hoặc cuối', modes: ['analyze', 'blind'], icon: '<svg viewBox="0 0 1024 1024"><path fill="#515151" d="M544 522.667c0-8.534-4.267-17.067-10.667-23.467L192 189.867c-12.8-12.8-34.133-10.667-44.8 2.133-12.8 12.8-10.667 34.133 2.133 44.8l315.734 285.867-315.734 285.866c-12.8 12.8-14.933 32-2.133 44.8 6.4 6.4 14.933 10.667 23.467 10.667s14.933-2.133 21.333-8.533l341.333-309.334c6.4-6.4 10.667-14.933 10.667-23.466"></path><path fill="#515151" d="M864 499.2 522.667 189.867c-12.8-12.8-34.134-10.667-44.8 2.133-12.8 12.8-10.667 34.133 2.133 44.8l315.733 285.867L480 808.533c-12.8 12.8-14.933 32-2.133 44.8 6.4 6.4 14.933 10.667 23.466 10.667s14.934-2.133 21.334-8.533L864 546.133c6.4-6.4 10.667-14.933 10.667-23.466S870.4 505.6 864 499.2"></path></svg>', customSvg: true },
    { id: 'guide-history', selector: '#panel-history', title: 'Biên bản nước đi', desc: 'Chọn nước đi để xem biến thể và chú thích. Bật “Hiện trên bàn cờ” để xem các biến thể.', modes: ['analyze', 'vsbot','puzzle'], icon: '<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z"/><path d="M20 18v-5.5L14 2H6a2 2 0 0 0-2 2v9"/>' },
    { id: 'guide-ai', selector: '#panel-ai', title: 'Khu vực Thông tin', desc: 'Chứa dữ liệu điểm số từ Máy tính, Sách khai cuộc, Biểu đồ và Ghi chú.', modes: ['analyze', 'vsbot', 'blind', 'puzzle', 'memorize'], icon: '<path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" /><path d="M4 12l16 0" /><path d="M12 4l0 16" />' }
];


let guideResizeObserver = null;
let highlightTrackingFrame = null; // Biến theo dõi animation

// Hàm đo và gán tọa độ cho khung xanh giả
function updateHighlightBox(targetEl) {
    const highlightBox = document.getElementById('guide-highlight-box');
    if (!highlightBox || !targetEl) return;

    highlightBox.style.display = 'block';

    // Hàm track liên tục tọa độ (dùng khi màn hình đang cuộn smooth scroll)
    const trackPosition = () => {
        const rect = targetEl.getBoundingClientRect();
        
        // Gán đúng kích thước và vị trí cho khung giả
        highlightBox.style.top = `${rect.top}px`;
        highlightBox.style.left = `${rect.left}px`;
        highlightBox.style.width = `${rect.width}px`;
        highlightBox.style.height = `${rect.height}px`;

        highlightTrackingFrame = requestAnimationFrame(trackPosition);
    };

    if (highlightTrackingFrame) cancelAnimationFrame(highlightTrackingFrame);
    trackPosition();

    // Dừng track sau 800ms (thời gian dư dả để quá trình scrollIntoView chạy xong)
    setTimeout(() => {
        if (highlightTrackingFrame) {
            cancelAnimationFrame(highlightTrackingFrame);
            highlightTrackingFrame = null;
        }
    }, 800);
}

function syncGuidePanelPosition() {
    const content = document.getElementById('guide-modal-content');
    const boardArea = document.getElementById('chess-board-area');
    if (!content || !boardArea) return;

    const rect = boardArea.getBoundingClientRect();
    const gWidth = rect.width * 0.8;
    const gHeight = rect.height * 0.9;
    const top = rect.top + (rect.height - gHeight) / 2;
    const left = rect.left + (rect.width - gWidth) / 2;

    content.style.setProperty('width', `${gWidth}px`, 'important');
    content.style.setProperty('height', `${gHeight}px`, 'important');
    content.style.setProperty('top', `${top}px`, 'important');
    content.style.setProperty('left', `${left}px`, 'important');
    content.style.setProperty('z-index', `2005`, 'important'); // Nâng cái bảng lên cao nhất
}

export function openGuidePanel() {
    const modal = document.getElementById('guide-modal');
    const container = document.getElementById('guide-list-container');
    if (!modal || !container) return;

    const currentMode = state.appMode || 'analyze';
    const activeTools = GUIDE_DATA.filter(tool => tool.modes.includes(currentMode));

    container.innerHTML = '';
    
    activeTools.forEach((tool, index) => {
        const strokeColor = tool.stroke || '#000000';
        const svgContent = tool.customSvg ? tool.icon : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${tool.icon}</svg>`;

        const item = document.createElement('div');
        item.className = 'guide-item';
        item.innerHTML = `
            <div class="guide-num">${index + 1}</div>
            <div class="guide-icon-box">${svgContent}</div>
            <div class="guide-text-box">
                <div class="guide-title">${tool.title}</div>
                <div class="guide-desc">${tool.desc}</div>
            </div>
        `;

        item.onclick = () => {
            container.querySelectorAll('.guide-item').forEach(el => el.classList.remove('guide-item-active'));
            item.classList.add('guide-item-active');

            clearUIHighlight();
            const targetEl = document.querySelector(tool.selector);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                updateHighlightBox(targetEl); // Vẽ khung giả lên target
            }
        };

        container.appendChild(item);
    });

    if (container.firstChild) container.firstChild.click();

    syncGuidePanelPosition();

    if (!guideResizeObserver) {
        guideResizeObserver = () => {
            syncGuidePanelPosition();
            // Cập nhật lại khung highlight nếu màn hình xoay/resize
            const activeItem = container.querySelector('.guide-item-active');
            if (activeItem) activeItem.click(); 
        };
        window.addEventListener('resize', guideResizeObserver);
        window.addEventListener('orientationchange', () => setTimeout(guideResizeObserver, 200));
    }

    modal.style.display = 'block';
    setTimeout(() => { modal.classList.add('show'); }, 30);
}

export function closeGuidePanel() {
    const modal = document.getElementById('guide-modal');
    if (!modal) return;
    
    clearUIHighlight();
    
    if (guideResizeObserver) {
        window.removeEventListener('resize', guideResizeObserver);
        window.removeEventListener('orientationchange', guideResizeObserver);
        guideResizeObserver = null;
    }
    
    modal.classList.remove('show');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
}

function clearUIHighlight() {
    // Tắt hiển thị khung giả
    const highlightBox = document.getElementById('guide-highlight-box');
    if (highlightBox) highlightBox.style.display = 'none';
    
    // Dừng vòng lặp tính tọa độ
    if (highlightTrackingFrame) {
        cancelAnimationFrame(highlightTrackingFrame);
        highlightTrackingFrame = null;
    }
}
