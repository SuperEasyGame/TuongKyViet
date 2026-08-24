// js/chart.js
import { state } from './state.js';

let canvasMain, ctxMain; 
let canvasY, ctxY;       
let isClickListenerAdded = false;

const Y_MAX = 1000;
const Y_MIN = -1000;
const X_SPACING = 35; // Khoảng cách chiều ngang
const Y_AXIS_WIDTH = 45; // Bề rộng trục Y
const BOX_HEIGHT = 18; // Chiều cao của ô chữ nhật chứa điểm số

export function initChartUI() {
    canvasMain = document.getElementById('analysis-chart');
    canvasY = document.getElementById('y-axis-canvas');
    if (!canvasMain || !canvasY) return;
    
    ctxMain = canvasMain.getContext('2d');
    ctxY = canvasY.getContext('2d');
    
    // Gắn sự kiện Click 1 lần duy nhất
    if (!isClickListenerAdded) {
        canvasMain.addEventListener('click', handleChartClick);
        isClickListenerAdded = true;
    }
    
    const scoreBar = document.querySelector('.score-bar-wrapper');
    const multipvList = document.getElementById('multipv-list-container');
    if (scoreBar) scoreBar.style.display = 'none';
    if (multipvList) multipvList.style.display = 'none';

    const chartWrapper = document.getElementById('chart-wrapper');
    if (chartWrapper) chartWrapper.style.display = 'block';

    state.chartData = [];
    
    requestAnimationFrame(() => { resizeAndDrawChart(); });
}

export function closeChartUI() {
    const scoreBar = document.querySelector('.score-bar-wrapper');
    const multipvList = document.getElementById('multipv-list-container');
    if (scoreBar) scoreBar.style.display = 'block';
    if (multipvList) multipvList.style.display = 'flex';

    const chartWrapper = document.getElementById('chart-wrapper');
    if (chartWrapper) chartWrapper.style.display = 'none';
    
    state.chartData = [];
}

export function addChartPoint(score, isRedMoved) {
    if (score > Y_MAX) score = Y_MAX;
    if (score < Y_MIN) score = Y_MIN;

    state.chartData.push({ score, isRedMoved });
    resizeAndDrawChart();
}

// Hàm này để các file khác (như board.js) gọi để ép vẽ lại con trỏ
export function refreshChartUI() {
    resizeAndDrawChart();
}

function getYPos(score, h) {
    const usableHeight = h * 0.8; // Chiều cao 80%
    const centerY = h / 2;        // Tâm nằm giữa
    return centerY - (score / 1000) * (usableHeight / 2);
}

function resizeAndDrawChart() {
    if (!canvasMain || !ctxMain || !canvasY || !ctxY) return;
    const wrapper = document.getElementById('chart-wrapper');
    const container = document.getElementById('chart-container');
    if (!wrapper || !container) return;

    const currentScroll = container.scrollLeft;

    canvasMain.style.width = '0px';
    canvasMain.style.height = '0px';

    const exactHeight = wrapper.clientHeight;
    const exactBaseWidth = wrapper.clientWidth; 
    
    if (exactHeight <= 0) return;

    const canvasRealWidth = Math.max(exactBaseWidth, Y_AXIS_WIDTH + (state.chartData.length * X_SPACING) + (X_SPACING * 2));
    const dpr = window.devicePixelRatio || 1;
    
    canvasMain.width = canvasRealWidth * dpr;
    canvasMain.height = exactHeight * dpr;
    canvasMain.style.width = `${canvasRealWidth}px`;
    canvasMain.style.height = `${exactHeight}px`;
    ctxMain.scale(dpr, dpr);
    ctxMain.clearRect(0, 0, canvasRealWidth, exactHeight);

    canvasY.width = Y_AXIS_WIDTH * dpr;
    canvasY.height = exactHeight * dpr;
    canvasY.style.width = `${Y_AXIS_WIDTH}px`;
    canvasY.style.height = `${exactHeight}px`;
    ctxY.scale(dpr, dpr);
    ctxY.clearRect(0, 0, Y_AXIS_WIDTH, exactHeight);

    drawGridLines(canvasRealWidth, exactHeight);
    drawYAxisText(exactHeight);                  
    drawDataPoints(exactHeight);                 
    drawCursor(exactHeight); // Vẽ con trỏ đứt nét
    
    // XỬ LÝ CUỘN (SCROLL)
    if (state.isChartDrawing) {
        // Đang tự vẽ bằng máy -> Cuộn dồn về bên phải cùng
        container.scrollLeft = container.scrollWidth;
    } else {
        // Đang xem lại bằng tay (Bấm phím / Click chuột)
        const stepIndex = state.currentStepNum - 1;
        if (stepIndex >= 0 && stepIndex < state.chartData.length) {
            // Tọa độ X của điểm hiện tại
            const pointX = Y_AXIS_WIDTH + ((stepIndex + 1) * X_SPACING);
            // Cuộn sao cho điểm đó nằm ở giữa màn hình (hoặc xuất hiện trong View)
            container.scrollLeft = pointX - (container.clientWidth / 2);
        } else {
            container.scrollLeft = currentScroll;
        }
    }
}

// Xử lý Click trên Canvas để nhảy nước cờ
function handleChartClick(e) {
    if (state.isChartDrawing) return; // Không cho click khi máy đang vẽ tự động

    const xClick = e.offsetX;
    
    // Quy đổi tọa độ X thành số thứ tự của nước đi (Index)
    let index = Math.round((xClick - Y_AXIS_WIDTH) / X_SPACING) - 1;
    
    if (index >= 0 && index < state.chartData.length) {
        let targetNode = state.rootNode;
        for (let i = 0; i <= index; i++) {
            if (targetNode.children.length > 0) {
                targetNode = targetNode.children[targetNode.mainLineIndex];
            } else break;
        }

        import('./game.js').then(game => {
            game.forceStopAIPlayers();
            game.instantJumpToNode(targetNode);
        });
    }
}

// VẼ CON TRỎ (Đường đứt nét + Text điểm số ở trên + Nước đi ở dưới)
function drawCursor(h) {
    const stepIndex = state.currentStepNum - 1;
    if (stepIndex < 0 || stepIndex >= state.chartData.length) return;

    const point = state.chartData[stepIndex];
    // Thay đổi góc nhìn điểm số tùy theo hướng bàn cờ
    const displayScore = state.isBoardFlipped ? -point.score : point.score;
    const x = Y_AXIS_WIDTH + ((stepIndex + 1) * X_SPACING);

    ctxMain.save();
    
    // 1. Vẽ Text điểm số ở trên cùng (Chữ màu đen)
    ctxMain.fillStyle = "#000000"; 
    ctxMain.font = "bold 11px Arial"; 
    ctxMain.textAlign = "center";
    ctxMain.textBaseline = "top"; 
    
    const prefix = state.isBoardFlipped ? "Điểm Đen: " : "Điểm Đỏ: ";
    const textScore = displayScore > 0 ? `+${displayScore}` : displayScore.toString();
    ctxMain.fillText(prefix + textScore, x, 2);

    // 2. Tìm tên nước đi (Notation) từ cây Node
    let currNode = state.rootNode;
    for (let i = 0; i <= stepIndex; i++) {
        if (currNode && currNode.children.length > 0) {
            currNode = currNode.children[currNode.mainLineIndex];
        } else {
            break;
        }
    }
    const moveText = (currNode && currNode.notation) ? currNode.notation : "";

    // 3. Vẽ đường đứt nét
    // Điểm kết thúc của đường đứt nét lùi lên 20px so với đáy Canvas
    const bottomLineY = h - 20; 
    
    ctxMain.beginPath();
    ctxMain.setLineDash([5, 4]); // Nét đứt (5 nét, 4 khoảng trống)
    ctxMain.moveTo(x, 16);
    ctxMain.lineTo(x, bottomLineY);
    ctxMain.strokeStyle = "#1a73e8"; // Cố định màu xanh dương
    ctxMain.lineWidth = 1.5;
    ctxMain.stroke();

    // 4. Vẽ Text Nước đi ở dưới đáy Canvas
    if (moveText) {
        // Nếu là Đỏ đi -> Màu Đỏ, Đen đi -> Màu Đen
        ctxMain.fillStyle = point.isRedMoved ? "#cc0000" : "#000000";
        ctxMain.font = "bold 11px Arial";
        ctxMain.textBaseline = "bottom"; // Căn bám đáy
        ctxMain.fillText(moveText, x, h - 2); // In chữ cách đáy 2px
    }

    ctxMain.restore();
}

function drawGridLines(w, h) {
    const steps = [-1000, -750, -500, -250, 0, 250, 500, 750, 1000];
    steps.forEach(val => {
        const y = getYPos(val, h);
        ctxMain.beginPath();
        ctxMain.moveTo(Y_AXIS_WIDTH, y);
        ctxMain.lineTo(w, y);
        
        if (val === 0) { ctxMain.strokeStyle = "#999"; ctxMain.lineWidth = 1.5; } 
        else { ctxMain.strokeStyle = "#e8e8e8"; ctxMain.lineWidth = 1; }
        ctxMain.stroke();
    });
}

function drawYAxisText(h) {
    const steps = [-1000, -750, -500, -250, 0, 250, 500, 750, 1000];
    ctxY.font = "10px Arial";
    ctxY.textAlign = "right";
    ctxY.textBaseline = "middle";

    steps.forEach(val => {
        const y = getYPos(val, h);
        if (val > 0) ctxY.fillStyle = "#008a3e";       
        else if (val < 0) ctxY.fillStyle = "#d32f2f";  
        else ctxY.fillStyle = "#333333";               
        ctxY.fillText(val.toString(), Y_AXIS_WIDTH - 5, y);
    });
}

function drawDataPoints(h) {
    if (state.chartData.length === 0) return;

    ctxMain.lineWidth = 2;
    ctxMain.strokeStyle = "#1a73e8"; 
    ctxMain.beginPath();

    state.chartData.forEach((point, index) => {
        const x = Y_AXIS_WIDTH + ((index + 1) * X_SPACING);
        // Thay đổi góc nhìn tọa độ Y tùy theo hướng bàn cờ
        const displayScore = state.isBoardFlipped ? -point.score : point.score;
        const y = getYPos(displayScore, h);
        
        if (index === 0) ctxMain.moveTo(x, y);
        else ctxMain.lineTo(x, y);
    });
    ctxMain.stroke();

    state.chartData.forEach((point, index) => {
        const x = Y_AXIS_WIDTH + ((index + 1) * X_SPACING);
        // Thay đổi góc nhìn tọa độ Y tùy theo hướng bàn cờ
        const displayScore = state.isBoardFlipped ? -point.score : point.score;
        const y = getYPos(displayScore, h);
        
        ctxMain.beginPath();
        ctxMain.arc(x, y, 4, 0, 2 * Math.PI);
        ctxMain.fillStyle = point.isRedMoved ? "#cc0000" : "#000000";
        ctxMain.fill();
        ctxMain.strokeStyle = "#fff";
        ctxMain.lineWidth = 1.5;
        ctxMain.stroke();
    });
}
window.addEventListener('resize', () => {
    if (state.isChartRunning || document.getElementById('chart-wrapper').style.display === 'block') {
        resizeAndDrawChart();
    }
});
window.addEventListener('orientationchange', () => {
    setTimeout(resizeAndDrawChart, 200);
});