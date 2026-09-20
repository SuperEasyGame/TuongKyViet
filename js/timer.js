// js/timer.js

let remainingMs = 0;
let incrementMs = 0;
let intervalId = null;
let isRunning = false;
let tickCallback = null;
let timeoutCallback = null;
let lastTickTime = 0;

export const PlayerTimer = {
    // Khởi tạo ván mới
    init(minutes, incrementSec) {
        this.stop();
        remainingMs = minutes * 60 * 1000;
        incrementMs = incrementSec * 1000;
    },

    // Load lại ván đang chơi dở
    load(savedMs, incrementSec) {
        this.stop();
        remainingMs = savedMs;
        incrementMs = incrementSec * 1000;
    },

    // Bắt đầu đếm ngược
    start(onTick, onTimeout) {
        if (isRunning || remainingMs <= 0) return;
        
        tickCallback = onTick;
        timeoutCallback = onTimeout;
        isRunning = true;
        lastTickTime = Date.now();

        intervalId = setInterval(() => {
            const now = Date.now();
            const delta = now - lastTickTime;
            lastTickTime = now;

            remainingMs -= delta;

            if (remainingMs <= 0) {
                remainingMs = 0;
                this.stop();
                if (timeoutCallback) timeoutCallback();
            }

            if (tickCallback) tickCallback(this.getFormattedTime());
        }, 100); // Cập nhật mỗi 100ms để mượt mà
    },

    // Dừng đồng hồ
    stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        isRunning = false;
    },

    // Thêm thời gian tích lũy sau khi đi cờ
    addIncrement() {
        if (incrementMs > 0 && remainingMs > 0) {
            remainingMs += incrementMs;
            if (tickCallback) tickCallback(this.getFormattedTime());
        }
    },

    // Lấy thời gian còn lại (để lưu vào database)
    getRemainingMs() {
        return remainingMs;
    },

    // Tiện ích Format dạng MM:SS
    getFormattedTime() {
        if (remainingMs <= 0) return "00:00";
        const totalSeconds = Math.ceil(remainingMs / 1000);
        const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const secs = (totalSeconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }
};