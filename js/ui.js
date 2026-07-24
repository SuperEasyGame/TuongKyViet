// js/ui.js
import { state } from './state.js';
import { forceStopAIPlayers, jumpToNode, ensureNodeData,loadGameFromList } from './game.js';

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
    if (state.appMode === 'analyze') return;
    
    const spinner = document.getElementById('ai-thinking-spinner');
    if (spinner) spinner.style.display = 'block';
}
export function hideAILoading() {
    const spinner = document.getElementById('ai-thinking-spinner');
    if (spinner) spinner.style.display = 'none';
}