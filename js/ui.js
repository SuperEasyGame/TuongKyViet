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
    setTimeout(() => { modal.classList.add('show'); }, 10);
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
// CÔNG NGHỆ VIRTUAL LIST DÀNH CHO THƯ VIỆN
// ==========================================
let currentLibraryData = [];
let libDomPool = [];
const LIB_ITEM_HEIGHT = 48; // Chiều cao = đúng CSS .lib-item
const LIB_VISIBLE_ITEMS = 25; // Số nút tạo ra tái chế
export let pendingDeleteLibId = "";

export async function renderLibraryList() {
    showLoading("Đang tải thư viện...");
    const rawList = await getWorkspace('library_workspace') || [];
    // 1. ĐẢO NGƯỢC DANH SÁCH (Mới nhất lên đầu)
    currentLibraryData = rawList.slice().reverse(); 

    const viewport = document.getElementById('lib-list-viewport');
    const spacer = document.getElementById('lib-list-spacer');
    const container = document.getElementById('lib-list-container');
    const emptyText = document.getElementById('lib-empty-text');

    if (currentLibraryData.length === 0) {
        emptyText.style.display = 'block';
        spacer.style.height = '0px';
        container.innerHTML = '';
        libDomPool = []; // Reset pool
        hideLoading();
        return;
    } else {
        emptyText.style.display = 'none';
    }

    // 2. KHỞI TẠO DOM POOL LẦN ĐẦU (Nếu chưa có)
    if (libDomPool.length === 0) {
        container.innerHTML = '';
        for (let i = 0; i < LIB_VISIBLE_ITEMS; i++) {
            const item = document.createElement('div');
            item.className = 'lib-item';
            item.innerHTML = `
                <span class="lib-title"></span>
                <button class="lib-btn-del" title="Xóa ván này">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            `;
            
            // Xử lý Click để Load ván cờ
            item.onclick = (e) => {
                if(e.target.closest('.lib-btn-del')) return; // Bỏ qua nếu bấm trúng nút xóa
                loadGameFromLibrary(item.dataset.idkey);
            };

            // Xử lý Click nút Xóa
            item.querySelector('.lib-btn-del').onclick = (e) => {
                e.stopPropagation(); // Cấm nổi bọt xuống item.onclick
                pendingDeleteLibId = item.dataset.idkey;
                document.getElementById('delete-lib-name').innerText = item.dataset.filename;
                openModal('delete-lib-modal');
            };

            libDomPool.push(item);
            container.appendChild(item);
        }
        
        viewport.addEventListener('scroll', () => {
            requestAnimationFrame(updateLibraryVirtualList);
        });
    }

    // 3. SET CHIỀU CAO ẢO & RENDER TRANG 1
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
            dom.dataset.idkey = data.id_key;
            dom.dataset.filename = data.file_name;
            
            const titleEl = dom.querySelector('.lib-title');
            titleEl.innerText = data.file_name;
            titleEl.title = data.file_name; // Hiện tooltip nếu dài
        } else {
            dom.style.display = 'none';
        }
    }
}

// Logic Nạp ván cờ từ Thư viện
// Logic Nạp ván cờ từ Thư viện
async function loadGameFromLibrary(idKey) {
    showLoading("Đang mở ván cờ...");
    try {
        const textData = await getWorkspace(idKey);
        if (textData) {
            const nodeData = vschess.dataToNode(textData);
            const infoData = vschess.dataToInfo(textData);
            if (nodeData && nodeData.fen) {
                
                // =======================================================
                // CƯỠNG CHẾ TRỞ VỀ CHẾ ĐỘ PHÂN TÍCH (ANALYZE MODE)
                // =======================================================
                state.appMode = 'analyze';
                state.appSettings.appMode = 'analyze';
                
                // 1. Dọn dẹp CSS của chế độ Bot / Cờ mù / Luyện Nhớ Ván
                document.body.classList.remove('mode-vsbot', 'mode-blind', 'mode-memorize');
                const navBar = document.getElementById('nav-bar');
                if (navBar) { navBar.style.opacity = '1'; navBar.style.pointerEvents = 'auto'; }
                state.isPeeking = false;

                // 2. Reset Tiêu đề Tab
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

                // 3. Reset Active Menu
                document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
                const activeMenuBtn = document.getElementById('menu-analyze');
                if (activeMenuBtn) activeMenuBtn.classList.add('menu-item-active');

                // 4. Tắt các nút Máy đánh (nếu có)
                const btnRed = document.getElementById('btn-ai-red');
                if(btnRed) btnRed.classList.remove('tool-active');
                const btnBlack = document.getElementById('btn-ai-black');
                if(btnBlack) btnBlack.classList.remove('tool-active');
                state.aiPlaysRed = false;
                state.aiPlaysBlack = false;
                // =======================================================

                state.gameList = [{ info: infoData, node: nodeData }];
                
                // 5. Import động các Module để thực thi lệnh
                const [gameModule, ioModule, stateModule] = await Promise.all([
                    import('./game.js'),
                    import('./io.js'),
                    import('./state.js')
                ]);
                
                stateModule.storage.saveSystem(state.appSettings); // Lưu Setting
                gameModule.forceStopAIPlayers(); // Hủy các luồng AI đang chạy
                gameModule.loadGameFromList(0); // Nạp ván cờ lên giao diện
                
                // Vì mode hiện tại đã là 'analyze', hàm này sẽ tự động đè ván cờ vào "analyze_workspace"
                ioModule.saveGameState(); 
                
                closeModal('library-modal');
                //showToast("✅ Đã mở ván cờ trong Chế Độ Phân Tích!");
            } else {
                showToast("❌ File lỗi hoặc không hợp lệ!");
            }
        } else {
            showToast("❌ Không tìm thấy ván cờ (Đã bị xóa?)");
        }
    } catch(e) { showToast("❌ Lỗi khi đọc dữ liệu!"); }
    hideLoading();
}

// Logic Xác nhận Xóa ván cờ
export async function confirmDeleteLibraryItem() {
    closeModal('delete-lib-modal');
    showLoading("Đang xóa...");
    try {
        // 1. Xóa nội dung ván cờ thật sự khỏi IndexedDB
        await deleteWorkspace(pendingDeleteLibId);
        
        // 2. Tìm và xóa dòng đó khỏi mảng 'library_workspace'
        let list = await getWorkspace('library_workspace') || [];
        list = list.filter(item => item.id_key !== pendingDeleteLibId);
        await saveWorkspace('library_workspace', list);
        
        // 3. Render lại danh sách Virtual (Nó sẽ tự reload list mới)
        await renderLibraryList();
        showToast("✅ Đã xóa ván cờ thành công!");
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
    showLoading("Đang tải thư viện...");
    const rawList = await getWorkspace('library_workspace') || [];
    currentLibraryData = rawList.slice().reverse(); 

    const viewport = document.getElementById('memo-list-viewport');
    const spacer = document.getElementById('memo-list-spacer');
    const container = document.getElementById('memo-list-container');
    const emptyText = document.getElementById('memo-empty-text');

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
            // Custom lại Item: Không có nút xóa
            item.innerHTML = `<span class="lib-title" style="text-align: center; width: 100%; padding: 0;"></span>`;
            
            // Xử lý Click: Tải nháp Data -> Mở Setup
            item.onclick = async () => {
                showLoading("Đang nạp ván đấu...");
                try {
                    const textData = await getWorkspace(item.dataset.idkey);
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
            dom.dataset.idkey = data.id_key;
            
            const titleEl = dom.querySelector('.lib-title');
            titleEl.innerText = data.file_name;
            titleEl.title = data.file_name;
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