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
    if (state.appMode === 'analyze' || state.appMode === 'blind') return;
    
    const spinner = document.getElementById('ai-thinking-spinner');
    if (spinner) spinner.style.display = 'block';
}
export function hideAILoading() {
    if (state.appMode === 'analyze' || state.appMode === 'blind') return;
    
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