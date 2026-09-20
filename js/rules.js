// js/rules.js
import { state } from './state.js';
import createXiangqiModule from '../rules/xiangqi_rule.js'; 

let xqModule = null;
let ruleEngine = null;

// 1. KHỞI TẠO WEBASSEMBLY MODULE VÀ ENGINE LUẬT CỜ
createXiangqiModule({
    locateFile: (path) => {
        // SỬA LỖI: file wasm được tải từ góc nhìn của index.html, nên đường dẫn là ./rules/...
        if (path.endsWith('.wasm')) return './rules/xiangqi_rule.wasm';
        return path;
    }
}).then((module) => {
    xqModule = module;
    ruleEngine = new xqModule.XiangqiRule();
    console.log("✅ Đã tải thành công C++ Rule Engine (WASM)");
}).catch((err) => {
    console.error("❌ Lỗi tải Rule Engine WASM:", err);
});

// Kiểm tra xem hiện tại có phải là lượt của Người Chơi không
function isPlayerTurn(fen) {
    const isRedTurn = fen.split(" ")[1] === "w";
    
    if (state.appMode === 'vsbot') {
        return (isRedTurn && state.vsBotSettings.botColor === 'black') || 
               (!isRedTurn && state.vsBotSettings.botColor === 'red');
    } else if (state.appMode === 'puzzle') {
        return (isRedTurn && !state.aiPlaysRed) || 
               (!isRedTurn && !state.aiPlaysBlack);
    }
    
    return true; 
}

// Trích xuất lịch sử nước đi thành Mảng Array (Dễ đẩy vào C++ Vector)
function getHistoryMovesArray(node) {
    let path = [];
    let curr = node;
    while (curr && curr !== state.rootNode) {
        if (curr.moveCommand) path.push(curr.moveCommand);
        curr = curr.parent;
    }
    path.reverse();
    return path;
}

// ====================================================================
// 2. KIỂM TRA HÒA CỜ (60 NƯỚC / LẶP LẠI HÒA) QUA WASM
// ====================================================================

export function checkDraw60Moves(node) {
    // Chỉ áp dụng cho chế độ Đấu Bot và Giải bài tập
    if (state.appMode !== 'vsbot' && state.appMode !== 'puzzle') return false;

    // Nếu WASM chưa tải xong, bỏ qua
    if (!ruleEngine || !xqModule) return false;

    try {
        const rootFen = state.rootNode.fen;
        const historyArray = getHistoryMovesArray(node);

        // Tạo C++ VectorString để truyền qua WASM
        let vecMoves = new xqModule.VectorString();
        for (let i = 0; i < historyArray.length; i++) {
            vecMoves.push_back(historyArray[i]);
        }

        // Gọi C++ kiểm tra trạng thái
        let status = ruleEngine.getGameState(rootFen, vecMoves);
        
        // Cực kỳ quan trọng: Phải xóa Vector sau khi dùng để tránh rò rỉ RAM
        vecMoves.delete();

        return status === "DRAW";

    } catch (e) {
        console.error("WASM Draw Check Error:", e);
        return false;
    }
}

// ====================================================================
// 3. LỌC NƯỚC ĐI HỢP LỆ (CẤM CHIẾU DÀI / BẮT DÀI) BẰNG WASM
// ====================================================================

export function getStrictLegalMoves(situation, fen) {
    // Lấy toàn bộ nước đi hợp lệ theo luật di chuyển cơ bản (chưa xét luật lặp lại)
    let moves = vschess.legalMoveList(situation);

    // Không lọc nếu không phải Đấu Bot / Giải bài tập
    if (state.appMode !== 'vsbot' && state.appMode !== 'puzzle') return moves;

    // Lượt của AI -> Bỏ qua kiểm tra để tăng tốc độ. Engine Pikafish tự biết đi đúng luật.
    if (!isPlayerTurn(fen)) {
        return moves;
    }

    // Lượt của Người chơi -> Lọc bỏ các nước vi phạm luật cấm
    if (ruleEngine && xqModule) {
        try {
            const rootFen = state.rootNode.fen;
            const historyArray = getHistoryMovesArray(state.currentNode);
            const isRedTurn = fen.split(" ")[1] === "w";

            return moves.filter(move => {
                // Giả lập: Nếu người chơi đi nước cờ này, lịch sử sẽ ra sao?
                let testHistory = [...historyArray, move];

                // Đưa vào Vector C++
                let vecMoves = new xqModule.VectorString();
                for (let i = 0; i < testHistory.length; i++) {
                    vecMoves.push_back(testHistory[i]);
                }

                // Gọi C++ kiểm tra
                let status = ruleEngine.getGameState(rootFen, vecMoves);
                vecMoves.delete(); // Dọn rác RAM

                // PHÁN QUYẾT:
                // Nếu đi nước này mà C++ trả về Đen thắng (tức Đỏ bị xử thua do vi phạm luật)
                if (isRedTurn && status === "BLACK_WIN") return false;
                
                // Nếu đi nước này mà C++ trả về Đỏ thắng (tức Đen bị xử thua do vi phạm luật)
                if (!isRedTurn && status === "WHITE_WIN") return false;

                // Nước đi an toàn, không vi phạm
                return true; 
            });

        } catch (e) {
            console.error("WASM Move Validation Error:", e);
            return moves; // Trả về mặc định nếu lỡ có lỗi C++
        }
    }

    return moves;
}