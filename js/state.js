// js/state.js
import { defaultGameInfo } from './config.js';

export const storage = {
    saveSystem: function(data) { localStorage.setItem('xiangqi_system', JSON.stringify(data)); },
    getSystem: function() { return JSON.parse(localStorage.getItem('xiangqi_system')) || null; },
    
    saveAnalysis: function(data) { localStorage.setItem('xiangqi_analysis', JSON.stringify(data)); },
    getAnalysis: function() { return JSON.parse(localStorage.getItem('xiangqi_analysis')) || null; },
    
    saveVsBot: function(data) { localStorage.setItem('xiangqi_vsbot', JSON.stringify(data)); },
    getVsBot: function() { return JSON.parse(localStorage.getItem('xiangqi_vsbot')) || null; }
};

const defaultSystem = {
    appMode: "analyze", 
    cloudBookEnabled: true, 
    cloudBookLimit: 10,
    animation: true,
    arrows: true,
    sound: true,
    boardStyle: "style/1-mac_dinh", 
    pieceStyle: "style/1-mac_dinh"
};

const defaultAnalysis = {
    skill: 20, threads: 1, hash: 64, multiPV: 1, moveTime: 1.0, depth: 30, 
};

const defaultVsBot = {
    botColor: "black", 
    botStyle: "standard", 
    level: 1
};

const savedSystem = Object.assign({}, defaultSystem, storage.getSystem());
const savedAnalysis = Object.assign({}, defaultAnalysis, storage.getAnalysis());
const savedVsBot = Object.assign({}, defaultVsBot, storage.getVsBot());

savedSystem.appMode = "analyze";

export const state = {
    appMode: savedSystem.appMode, 
    vsBotSetupOrigin: 'menu', // 'menu' hoặc 'toolbar'

    // --- BIẾN MỚI CHO QUẢN LÝ LIST VÁN ĐẤU ---
    gameList: [],         // Mảng chứa các Object ván đấu thô (Phục vụ CBL và Workspace)
    currentGameIndex: 0,  // Đang xem ván thứ mấy trong mảng
    // -----------------------------------------
    
    currentGameInfo: Object.assign({}, defaultGameInfo),
    rootNode: null,
    currentNode: null,
    currentStepNum: 0,
    currentSituation: [],
    selectedSquare: null,
    legalMoves: [],
    lastMove: null,

    isBoardFlipped: false,
    aiPlaysRed: false,
    aiPlaysBlack: false,
    isAnalyzing: false,
    engineModule: null,
    hasAutoSwitchedToAnalyze: false,

    autoPlayInterval: null,
    isAutoPlaying: false,
    isAnimating: false,
    isPeeking: false,
    pendingAIMove: null,
    
    pvLines: [],
    customArrows: [],

    puzzleHistory: [],
    currentPuzzleFolder: { path: 'data', name: '' },
    puzzleFens: [],
    isViewingPuzzleFens: false,
    currentPuzzleName: "",   
    currentPuzzleIndex: 0,
    currentPuzzleMaxMoves: 1000,
    currentPuzzleKey: "", 
    currentPuzzleSolved: [],         
    currentPuzzleSolvedKey: "", 

    puzzleOpenedFromMenu: false,      
    memorizeOpenedFromMenu: false,

    currentLibraryFolderId: "root", 
    libraryHistory: [],

    currentMemoFolderId: "root", 
    memoHistory: [],

    appSettings: savedSystem,
    aiSettings: savedAnalysis,
    vsBotSettings: savedVsBot,

    chartSettings: { depth: 20, time: 2 },
    isChartRunning: false,
    isChartDrawing: false,
    chartData: [],

    isEditMode: false,
    selectedPalettePiece: null,
    selectedBoardPiece: null,
    editTurn: 'w',
    preEditFenBase: "",
    preEditTurn: "",
    preEditNode: null,
    preEditStepNum: 0,

    pendingDownloadType: "",
    editingParentNode: null,

    pendingMemorizeData: null, // Chứa ván cờ tạm thời khi chọn/tải file
    memorizeSettings: { side: 'red', path: 'manual', isBlind: false, startNodeId: null, endNodeId: null}, // Lưu cấu hình
    memoMistakesRed: 0,
    memoMistakesBlack: 0
};